/**
 * Phase 2 hooks: files, memories, projects and search — optimistic updates,
 * rollback on failure, lifecycle reporting and per-user isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mock = await vi.hoisted(async () => (await import('../test/mockSupabase')).createMockSupabase());
vi.mock('../lib/supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import { useKnowledge } from './useKnowledge';
import { useMemories } from './useMemories';
import { useProjects } from './useProjects';
import { useSearch } from './useSearch';
import { memoriesApi, projectsApi } from '../lib/knowledge/api';

const ALICE = { id: 'user-1', email: 'test@example.com' };
const BOB = { id: 'user-2', email: 'other@example.com' };
const user = ALICE as never;
const bob = BOB as never;
const textFile = (name: string, content: string, type = 'text/plain') => new File([content], name, { type });

beforeEach(() => {
  for (const t of Object.keys(mock.tables)) mock.tables[t] = [];
  for (const k of Object.keys(mock.storage)) delete mock.storage[k];
  mock.setUser(ALICE);
});

describe('useKnowledge', () => {
  it('uploads, reports each lifecycle step, and exposes the ready file', async () => {
    const { result } = renderHook(() => useKnowledge(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.files).toEqual([]);

    const seen: string[] = [];
    let outcome!: Awaited<ReturnType<typeof result.current.uploadFiles>>;
    await act(async () => {
      outcome = await result.current.uploadFiles([textFile('notes.md', '# Roadmap\n\nShip search in Q4.', 'text/markdown'), textFile('deck.pptx', 'x', 'application/octet-stream')], {
        projectId: 'p1', onChange: f => seen.push(f.status),
      });
    });
    expect(seen).toEqual(['uploading', 'processing', 'ready']);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatch(/\.pptx/);
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0]).toMatchObject({ name: 'notes.md', status: 'ready', project_id: 'p1' });
  });

  it('scopes files for a chat to those attached to it or in its project', async () => {
    const { result } = renderHook(() => useKnowledge(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.uploadFiles([textFile('a.txt', 'alpha')], { projectId: 'p1' });
      await result.current.uploadFiles([textFile('b.txt', 'bravo')], { conversationId: 'c1' });
      await result.current.uploadFiles([textFile('c.txt', 'charlie')]);
    });
    expect(result.current.files).toHaveLength(3);
    const names = (ids: ReturnType<typeof result.current.filesForChat>) => ids.map(f => f.name).sort();
    expect(names(result.current.filesForChat('c1', 'p1'))).toEqual(['a.txt', 'b.txt']);
    expect(names(result.current.filesForChat('c1', null))).toEqual(['b.txt']);
    expect(names(result.current.filesForChat('other', null))).toEqual([]);
    expect(names(result.current.filesForChat(null, null))).toEqual([]);

    await act(async () => { await result.current.attachToConversation([result.current.files.find(f => f.name === 'c.txt')!.id], 'c1'); });
    expect(names(result.current.filesForChat('c1', null))).toEqual(['b.txt', 'c.txt']);
  });

  it('deletes optimistically and rolls back when the server refuses', async () => {
    const { result } = renderHook(() => useKnowledge(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.uploadFiles([textFile('keep.txt', 'keep me')]); });
    const file = result.current.files[0];

    const original = mock.client.from;
    mock.client.from = vi.fn((table: string) => {
      const q = original(table) as Record<string, unknown>;
      if (table === 'files') q.delete = () => ({ eq: async () => ({ error: { code: '42501', message: 'permission denied' } }) });
      return q;
    }) as typeof original;
    try {
      await act(async () => { await expect(result.current.deleteFile(file)).rejects.toThrow(); });
    } finally { mock.client.from = original; }
    expect(result.current.files.map(f => f.id)).toEqual([file.id]);

    await act(async () => { await result.current.deleteFile(file); });
    expect(result.current.files).toEqual([]);
    expect(mock.tables.files).toEqual([]);
    expect(mock.tables.file_chunks).toEqual([]);
  });

  it('retries a failed file and surfaces the failure reason', async () => {
    const { result } = renderHook(() => useKnowledge(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.uploadFiles([textFile('bad.json', '{oops')]); });
    const failed = result.current.files[0];
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    // Fix the stored object, then retry → ready.
    mock.storage[failed.storage_path].bytes = new TextEncoder().encode(JSON.stringify({ fixed: true }));
    await act(async () => { await result.current.retryProcessing(failed); });
    expect(result.current.files[0].status).toBe('ready');
    expect(result.current.files[0].error).toBeNull();
  });

  it('only ever lists the signed-in user’s files', async () => {
    const { result } = renderHook(() => useKnowledge(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.uploadFiles([textFile('mine.txt', 'mine')]); });
    mock.setUser(BOB);
    const other = renderHook(() => useKnowledge(bob));
    await waitFor(() => expect(other.result.current.status).toBe('ready'));
    expect(other.result.current.files).toEqual([]);
  });
});

describe('useMemories', () => {
  it('adds, edits and deletes with optimistic state and validation', async () => {
    const { result } = renderHook(() => useMemories(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await expect(result.current.addMemory({ content: '   ' })).rejects.toThrow(/remember/i);
    await expect(result.current.addMemory({ content: 'x'.repeat(1001) })).rejects.toThrow(/1,000/);

    await act(async () => { await result.current.addMemory({ content: 'Prefers dark mode', type: 'preference', importance: 4 }); });
    expect(result.current.memories).toHaveLength(1);
    const id = result.current.memories[0].id;
    await act(async () => { await result.current.updateMemory(id, { content: 'Prefers dark mode everywhere' }); });
    expect(result.current.memories[0].content).toBe('Prefers dark mode everywhere');
    expect(mock.tables.memories[0].content).toBe('Prefers dark mode everywhere');
    await act(async () => { await result.current.deleteMemory(id); });
    expect(result.current.memories).toEqual([]);
    expect(mock.tables.memories).toEqual([]);
  });

  it('rolls back an optimistic edit when the server refuses', async () => {
    await memoriesApi.create(ALICE.id, { content: 'original' });
    const { result } = renderHook(() => useMemories(user));
    await waitFor(() => expect(result.current.memories).toHaveLength(1));
    const original = mock.client.from;
    mock.client.from = vi.fn((table: string) => {
      const q = original(table) as Record<string, unknown>;
      if (table === 'memories') q.update = () => ({ eq: async () => ({ error: { code: '42501', message: 'permission denied' } }) });
      return q;
    }) as typeof original;
    try {
      await act(async () => { await expect(result.current.updateMemory(result.current.memories[0].id, { content: 'changed' })).rejects.toThrow(); });
    } finally { mock.client.from = original; }
    expect(result.current.memories[0].content).toBe('original');
  });
});

describe('useProjects', () => {
  it('creates, renames, archives and deletes', async () => {
    const { result } = renderHook(() => useProjects(user));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await expect(result.current.createProject({ name: '  ' })).rejects.toThrow();

    let created!: Awaited<ReturnType<typeof result.current.createProject>>;
    await act(async () => { created = await result.current.createProject({ name: 'Website', instructions: 'Use Tailwind' }); });
    expect(result.current.projects.map(p => p.name)).toEqual(['Website']);
    await act(async () => { await result.current.updateProject(created.id, { name: 'Website v2' }); });
    expect(result.current.projects[0].name).toBe('Website v2');
    await act(async () => { await result.current.archiveProject(created.id, true); });
    expect(result.current.projects[0].archived).toBe(true);
    expect(mock.tables.projects[0].archived).toBe(true);
    await act(async () => { await result.current.deleteProject(created.id); });
    expect(result.current.projects).toEqual([]);
    expect(mock.tables.projects).toEqual([]);
  });

  it('never shows another user’s projects', async () => {
    await projectsApi.create(ALICE.id, { name: 'Alice only' });
    mock.setUser(BOB);
    const { result } = renderHook(() => useProjects(bob));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.projects).toEqual([]);
  });
});

describe('useSearch', () => {
  it('debounces, groups results by kind, ignores short queries and loads more per group', async () => {
    await projectsApi.create(ALICE.id, { name: 'Falcon' });
    for (let i = 0; i < 12; i++) await memoriesApi.create(ALICE.id, { content: `falcon memory ${i}` });
    mock.client.rpc.mockClear();

    const { result, rerender } = renderHook(({ q, on }: { q: string; on: boolean }) => useSearch(q, on), { initialProps: { q: '', on: true } });
    expect(result.current.status).toBe('idle');
    rerender({ q: 'f', on: true });
    await new Promise(r => setTimeout(r, 300));
    expect(mock.client.rpc).not.toHaveBeenCalled();

    rerender({ q: 'fal', on: true });
    rerender({ q: 'falc', on: true });
    rerender({ q: 'falcon', on: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mock.client.rpc).toHaveBeenCalledTimes(1); // debounced
    expect(result.current.groups.project?.map(r => r.title)).toEqual(['Falcon']);
    expect(result.current.groups.memory?.length).toBe(12);

    // Per-group pagination
    mock.tables.memories.length = 0;
    for (let i = 0; i < 45; i++) await memoriesApi.create(ALICE.id, { content: `falcon note ${i}` });
    rerender({ q: 'falcon notes', on: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = result.current.groups.memory?.length ?? 0;
    expect(before).toBeLessThan(45);
    await act(async () => { await result.current.loadMore('memory'); });
    expect(result.current.groups.memory!.length).toBeGreaterThan(before);

    // Closing the palette stops searching
    rerender({ q: 'falcon', on: false });
    mock.client.rpc.mockClear();
    await new Promise(r => setTimeout(r, 300));
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it('exposes a friendly error and can retry', async () => {
    const original = mock.client.rpc.getMockImplementation()!;
    mock.client.rpc.mockImplementationOnce(() => {
      const p = Promise.resolve({ data: null, error: { code: '57014', message: 'statement timeout', details: null, hint: null } });
      return Object.assign(p, { abortSignal: () => p }) as never;
    });
    const { result } = renderHook(() => useSearch('anything', true));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.title).toBeTruthy();
    mock.client.rpc.mockImplementation(original);
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
