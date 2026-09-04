/**
 * Service-level tests for the knowledge layer against the in-memory Supabase
 * mock, which simulates RLS (rows are only visible to their owner; inserts
 * that claim another owner fail) and owner-scoped Storage paths.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const mock = await vi.hoisted(async () => (await import('../../test/mockSupabase')).createMockSupabase());
vi.mock('../supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import { vi } from 'vitest';
import { fileService, FileValidationError } from './fileService';
import { filesApi, chunksApi, projectsApi, memoriesApi } from './api';
import { retrieveKnowledge } from './retriever';
import { searchAll } from './search';
import { conversationsApi, messagesApi } from '../chat/api';
import type { KnowledgeFile } from '../../types';
import { toFriendlyError } from '../errors';

/** Assert a promise fails the way an RLS violation surfaces to the UI. */
async function expectNoAccess(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy((e: unknown) => toFriendlyError(e).title === 'No access');
}

const ALICE = { id: 'alice', email: 'alice@example.com' };
const BOB = { id: 'bob', email: 'bob@example.com' };

const textFile = (name: string, content: string, type = 'text/plain') => new File([content], name, { type });

beforeEach(() => {
  for (const t of Object.keys(mock.tables)) mock.tables[t] = [];
  for (const k of Object.keys(mock.storage)) delete mock.storage[k];
  mock.setUser(ALICE);
});

describe('file upload lifecycle', () => {
  it('validates before any network call', async () => {
    expect(fileService.validate(textFile('empty.txt', ''))).toMatch(/empty/);
    expect(fileService.validate(textFile('deck.pptx', 'x', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))).toMatch(/\.pptx/);
    expect(fileService.validate({ name: 'big.txt', size: 21 * 1024 * 1024, type: 'text/plain' })).toMatch(/20 MB/);
    expect(fileService.validate(textFile('ok.md', '# hi'))).toBeNull();
    await expect(fileService.upload(textFile('deck.pptx', 'x', 'application/octet-stream'), { userId: ALICE.id })).rejects.toBeInstanceOf(FileValidationError);
    expect(mock.tables.files).toHaveLength(0);
  });

  it('moves through uploading → processing → ready and stores metadata, not raw content', async () => {
    const seen: string[] = [];
    const content = 'Quarterly revenue grew 12% year over year.\n\nChurn fell to 2.1% in the enterprise segment.';
    const row = await fileService.upload(textFile('q3.md', content, 'text/markdown'), {
      userId: ALICE.id, projectId: null, onChange: f => seen.push(f.status),
    });
    expect(seen).toEqual(['uploading', 'processing', 'ready']);
    expect(row.status).toBe('ready');
    expect(row.error).toBeNull();
    expect(row.chunk_count).toBe(1);
    expect(row.char_count).toBe(content.length);
    expect(row.mime_type).toBe('text/markdown');
    expect(row.size).toBe(content.length);
    expect(row.storage_path).toBe(`${ALICE.id}/${row.id}/q3.md`);
    expect(row.metadata).toMatchObject({ kind: 'markdown', extension: 'md', uploaded: true, truncated: false });
    expect(row.metadata.processed_at).toBeTruthy();
    expect(row.preview).toContain('Quarterly revenue');

    const persisted = mock.tables.files[0];
    expect(persisted.status).toBe('ready');
    expect(persisted.user_id).toBe(ALICE.id);
    expect(Object.keys(persisted)).not.toContain('content');
    expect(Object.keys(persisted)).not.toContain('text');
    expect(mock.storage[row.storage_path]).toBeDefined();
    expect(mock.tables.file_chunks).toHaveLength(1);
    expect(mock.tables.file_chunks[0]).toMatchObject({ file_id: row.id, user_id: ALICE.id, chunk_index: 0 });
  });

  it('marks unreadable files as failed with a reason and keeps them retryable', async () => {
    const row = await fileService.upload(textFile('broken.json', '{ not: json'), { userId: ALICE.id });
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/JSON/i);
    expect(row.chunk_count).toBe(0);
    expect(row.metadata.uploaded).toBe(true);
    expect(mock.tables.file_chunks).toHaveLength(0);
    // Retry keeps the failure explicit rather than pretending it worked.
    const again = await fileService.process(row);
    expect(again.status).toBe('failed');
    expect(again.error).toBe(row.error);
  });

  it('records a storage failure as failed and never leaves a phantom ready row', async () => {
    const original = mock.client.storage.from;
    mock.client.storage.from = vi.fn(() => ({
      ...original('knowledge'),
      upload: vi.fn(async () => ({ data: null, error: { name: 'StorageApiError', message: 'Payload too large', statusCode: '413' } })),
    })) as typeof original;
    try {
      const row = await fileService.upload(textFile('a.txt', 'hello world'), { userId: ALICE.id });
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(/Payload too large/);
      expect(row.metadata.uploaded).toBe(false);
      expect(mock.tables.files[0].status).toBe('failed');
    } finally { mock.client.storage.from = original; }
  });

  it('deletes the row, its chunks and the stored object', async () => {
    const row = await fileService.upload(textFile('notes.txt', 'alpha beta gamma'), { userId: ALICE.id });
    expect(mock.tables.file_chunks.length).toBeGreaterThan(0);
    await fileService.remove(row);
    expect(mock.tables.files).toHaveLength(0);
    expect(mock.tables.file_chunks).toHaveLength(0);
    expect(mock.storage[row.storage_path]).toBeUndefined();
  });

  it('never trusts a client-supplied owner id (RLS rejects rows for other users)', async () => {
    await expectNoAccess(filesApi.insert({
      id: crypto.randomUUID(), user_id: BOB.id, project_id: null, conversation_id: null, name: 'x.txt', mime_type: 'text/plain', size: 1,
      storage_path: `${BOB.id}/x/x.txt`, metadata: { kind: 'text', extension: 'txt', uploaded: false },
    } as never));
    // …and a storage path under another user's folder is rejected even with the right user_id.
    await expectNoAccess(filesApi.insert({
      id: crypto.randomUUID(), user_id: ALICE.id, project_id: null, conversation_id: null, name: 'x.txt', mime_type: 'text/plain', size: 1,
      storage_path: `${BOB.id}/x/x.txt`, metadata: { kind: 'text', extension: 'txt', uploaded: false },
    } as never));
    expect(mock.tables.files).toHaveLength(0);
  });

  it('isolates files between users: Bob cannot list, read, download or delete Alice’s file', async () => {
    const row = await fileService.upload(textFile('secret.txt', 'alice only content'), { userId: ALICE.id });

    mock.setUser(BOB);
    expect(await filesApi.list(BOB.id)).toEqual([]);
    expect(await filesApi.get(row.id)).toBeNull();
    await expect(filesApi.download(row.storage_path)).rejects.toThrow();
    expect(await chunksApi.listForFile(row.id)).toEqual([]);
    expect(await chunksApi.match(['alice'], [row.id])).toEqual([]);
    await fileService.remove(row); // silently affects nothing
    expect(mock.tables.files).toHaveLength(1);
    expect(mock.storage[row.storage_path]).toBeDefined();

    mock.setUser(ALICE);
    expect((await filesApi.list(ALICE.id)).map(f => f.id)).toEqual([row.id]);
  });

  it('signed URLs are only issued for the owner', async () => {
    const row = await fileService.upload(textFile('doc.txt', 'private text'), { userId: ALICE.id });
    expect(await filesApi.signedUrl(row.storage_path, 60)).toContain(row.storage_path);
    mock.setUser(BOB);
    await expect(filesApi.signedUrl(row.storage_path, 60)).rejects.toThrow();
  });
});

describe('memory', () => {
  it('creates, edits, lists and deletes memories with type, source and timestamps', async () => {
    const m = await memoriesApi.create(ALICE.id, { content: 'Prefers British English', type: 'preference', importance: 4 });
    expect(m).toMatchObject({ user_id: ALICE.id, type: 'preference', importance: 4, source: 'user', project_id: null });
    expect(m.created_at).toBeTruthy();
    await memoriesApi.update(m.id, { content: 'Prefers British English and short answers', importance: 5 });
    const list = await memoriesApi.list(ALICE.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('Prefers British English and short answers');
    expect(list[0].importance).toBe(5);
    await memoriesApi.remove(m.id);
    expect(await memoriesApi.list(ALICE.id)).toEqual([]);
  });

  it('rejects empty, oversized or out-of-range input', async () => {
    await expect(memoriesApi.create(ALICE.id, { content: '   ' })).rejects.toThrow();
    await expect(memoriesApi.create(ALICE.id, { content: 'x'.repeat(1001) })).rejects.toThrow();
    const m = await memoriesApi.create(ALICE.id, { content: 'ok', importance: 42 });
    expect(m.importance).toBeLessThanOrEqual(5);
    expect(m.importance).toBeGreaterThanOrEqual(1);
  });

  it('is only ever created explicitly (nothing is saved by sending chat messages)', async () => {
    const c = await conversationsApi.create(ALICE.id, 'My name is Ada and my card number is 4111');
    await messagesApi.insert({ conversation_id: c.id, role: 'user', content: 'My name is Ada and my card number is 4111 1111 1111 1111' } as never);
    expect(mock.tables.memories).toHaveLength(0);
  });

  it('isolates memories between users', async () => {
    const m = await memoriesApi.create(ALICE.id, { content: 'Alice fact' });
    mock.setUser(BOB);
    expect(await memoriesApi.list(BOB.id)).toEqual([]);
    await memoriesApi.update(m.id, { content: 'tampered' }); // affects nothing
    await memoriesApi.remove(m.id);
    await expectNoAccess(memoriesApi.create(ALICE.id, { content: 'forged for alice' }));
    mock.setUser(ALICE);
    const list = await memoriesApi.list(ALICE.id);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('Alice fact');
  });
});

describe('projects', () => {
  it('creates, renames, archives and deletes; deletion detaches chats/files and removes project memories', async () => {
    const p = await projectsApi.create(ALICE.id, { name: 'Launch', instructions: 'Be concise' });
    expect(p).toMatchObject({ user_id: ALICE.id, name: 'Launch', instructions: 'Be concise', archived: false });
    await projectsApi.update(p.id, { name: 'Launch v2' });
    await projectsApi.update(p.id, { archived: true });
    let list = await projectsApi.list(ALICE.id);
    expect(list[0]).toMatchObject({ name: 'Launch v2', archived: true });

    const conv = await conversationsApi.create(ALICE.id, 'Plan', p.id);
    const file = await fileService.upload(textFile('plan.txt', 'launch plan details'), { userId: ALICE.id, projectId: p.id });
    const mem = await memoriesApi.create(ALICE.id, { content: 'project memory', project_id: p.id });
    const globalMem = await memoriesApi.create(ALICE.id, { content: 'global memory' });
    expect(conv.project_id).toBe(p.id);
    expect(file.project_id).toBe(p.id);

    await projectsApi.remove(p.id);
    list = await projectsApi.list(ALICE.id);
    expect(list).toEqual([]);
    expect((await conversationsApi.list(ALICE.id))[0]).toMatchObject({ id: conv.id, project_id: null });
    expect((await filesApi.list(ALICE.id))[0]).toMatchObject({ id: file.id, project_id: null });
    const mems = await memoriesApi.list(ALICE.id);
    expect(mems.map(m => m.id)).toEqual([globalMem.id]);
    expect(mems.some(m => m.id === mem.id)).toBe(false);
  });

  it('rejects blank names', async () => {
    await expect(projectsApi.create(ALICE.id, { name: '   ' })).rejects.toThrow();
  });

  it('isolates projects between users', async () => {
    const p = await projectsApi.create(ALICE.id, { name: 'Alice project' });
    mock.setUser(BOB);
    expect(await projectsApi.list(BOB.id)).toEqual([]);
    await projectsApi.update(p.id, { name: 'hijacked' });
    await projectsApi.remove(p.id);
    await expectNoAccess(projectsApi.create(ALICE.id, { name: 'forged' }));
    mock.setUser(ALICE);
    expect((await projectsApi.list(ALICE.id)).map(x => x.name)).toEqual(['Alice project']);
  });
});

describe('knowledge retrieval', () => {
  async function seed() {
    const revenue = await fileService.upload(textFile('revenue.md', [
      'Quarterly revenue grew 12% year over year, driven by enterprise expansion.',
      'Gross margin improved to 71% thanks to infrastructure savings.',
      'The finance team expects revenue growth to continue into Q4.',
    ].join('\n\n'), 'text/markdown'), { userId: ALICE.id });
    const recipes = await fileService.upload(textFile('recipes.txt', [
      'Sourdough starter needs feeding twice a day at room temperature.',
      'For focaccia, use a very wet dough and plenty of olive oil.',
    ].join('\n\n')), { userId: ALICE.id });
    return { revenue, recipes };
  }

  it('returns only chunks relevant to the question, with source information', async () => {
    const { revenue, recipes } = await seed();
    const { chunks, sources } = await retrieveKnowledge({ query: 'How did revenue and gross margin develop?', files: [revenue, recipes] });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.file_id === revenue.id)).toBe(true);
    expect(chunks.some(c => c.file_id === recipes.id)).toBe(false);
    expect(sources).toEqual([{ file_id: revenue.id, file_name: 'revenue.md', chunk_indexes: chunks.map(c => c.chunk_index) }]);
  });

  it('sends no file context when nothing is relevant (never "all files")', async () => {
    const { revenue, recipes } = await seed();
    const res = await retrieveKnowledge({ query: 'Write a haiku about autumn leaves', files: [revenue, recipes] });
    expect(res.chunks).toEqual([]);
    expect(res.sources).toEqual([]);
  });

  it('ignores files that are not ready and files outside the chat scope', async () => {
    const { revenue } = await seed();
    const failed: KnowledgeFile = { ...revenue, id: 'failed-file', status: 'failed' };
    const res = await retrieveKnowledge({ query: 'revenue growth', files: [failed] });
    expect(res.chunks).toEqual([]);
    const scoped = await retrieveKnowledge({ query: 'revenue growth', files: [] });
    expect(scoped.chunks).toEqual([]);
  });

  it('falls back to the opening of an explicitly attached file when the question has no keywords', async () => {
    const { revenue, recipes } = await seed();
    const res = await retrieveKnowledge({ query: 'Summarise this.', files: [revenue, recipes], attachedFileIds: [recipes.id] });
    expect(res.chunks.length).toBeGreaterThan(0);
    expect(res.chunks.every(c => c.file_id === recipes.id)).toBe(true);
    expect(res.sources[0].file_name).toBe('recipes.txt');
  });

  it('respects the chunk and character budgets', async () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Section ${i}: the migration plan covers database migration step ${i} in detail. ${'migration '.repeat(40)}`);
    const big = await fileService.upload(textFile('migration.txt', paragraphs.join('\n\n')), { userId: ALICE.id });
    expect(big.chunk_count).toBeGreaterThan(4);
    const res = await retrieveKnowledge({ query: 'What is the migration plan?', files: [big], maxChunks: 3, charBudget: 3000 });
    expect(res.chunks.length).toBeLessThanOrEqual(3);
    expect(res.chunks.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(3000);
  });

  it('never retrieves another user’s chunks even when their file ids are known', async () => {
    const { revenue } = await seed();
    mock.setUser(BOB);
    const res = await retrieveKnowledge({ query: 'revenue growth margin', files: [revenue] });
    expect(res.chunks).toEqual([]);
  });
});

describe('global search', () => {
  async function seedEverything() {
    const p = await projectsApi.create(ALICE.id, { name: 'Falcon rollout', description: 'Rollout of the falcon feature' });
    const c = await conversationsApi.create(ALICE.id, 'Falcon pricing discussion', p.id);
    await messagesApi.insert({ conversation_id: c.id, role: 'user', content: 'What should falcon cost per seat?' } as never);
    await fileService.upload(textFile('falcon-spec.md', 'Falcon spec: the falcon feature ships in October.', 'text/markdown'), { userId: ALICE.id, projectId: p.id });
    await memoriesApi.create(ALICE.id, { content: 'Falcon is the codename for the analytics add-on', type: 'context' });
    return { p, c };
  }

  it('finds matches across all five kinds, with snippets and navigation targets', async () => {
    const { p, c } = await seedEverything();
    const page = await searchAll('falcon');
    const kinds = new Set(page.results.map(r => r.kind));
    expect([...kinds].sort()).toEqual(['conversation', 'file', 'memory', 'message', 'project']);
    const message = page.results.find(r => r.kind === 'message')!;
    expect(message.conversation_id).toBe(c.id);
    expect(message.snippet).toContain('⟦falcon⟧');
    expect(page.results.find(r => r.kind === 'project')!.id).toBe(p.id);
  });

  it('supports kind filters and pagination', async () => {
    await seedEverything();
    const files = await searchAll('falcon', { kinds: ['file'] });
    expect(files.results.every(r => r.kind === 'file')).toBe(true);
    const first = await searchAll('falcon', { limit: 2, offset: 0 });
    const second = await searchAll('falcon', { limit: 2, offset: 2 });
    expect(first.results).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(second.results.map(r => r.id)).not.toEqual(first.results.map(r => r.id));
  });

  it('returns nothing for too-short queries without hitting the database', async () => {
    await seedEverything();
    mock.client.rpc.mockClear();
    expect(await searchAll('f')).toEqual({ results: [], hasMore: false });
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it('is permission-aware: Bob sees none of Alice’s data', async () => {
    await seedEverything();
    mock.setUser(BOB);
    expect((await searchAll('falcon')).results).toEqual([]);
    await projectsApi.create(BOB.id, { name: 'Bob falcon' });
    const bob = await searchAll('falcon');
    expect(bob.results.map(r => r.title)).toEqual(['Bob falcon']);
  });
});
