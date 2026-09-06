/**
 * Phase 3 · Chunk 5: service-layer tests for conversations/messages — each
 * function's happy path, its error handling, and the RLS boundary.
 *
 * The mock client simulates Postgres row-level security the way the real
 * policies (`auth.uid() = user_id` for SELECT / INSERT / UPDATE / DELETE) behave
 * over PostgREST: another user's rows are simply *absent*. A cross-user UPDATE
 * or DELETE therefore matches 0 rows (never 403), an INSERT claiming another
 * owner fails with `42501`, and `.single()` over 0 rows yields `PGRST116`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = await vi.hoisted(async () => (await import('../../test/mockSupabase')).createMockSupabase());
vi.mock('../supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import { conversationsApi, messagesApi, ConversationNotFoundError, toStoredAttachments } from './api';
import { AppError } from '../errors';
import type { Message } from '../../types';

const alice = { id: 'alice', email: 'alice@example.com' };
const bob = { id: 'bob', email: 'bob@example.com' };
const asUser = (u: { id: string; email: string } | null) => mock.setUser(u);

const msg = (id: string, conversation_id: string, content: string, role: Message['role'] = 'user'): Message =>
  ({ id, conversation_id, role, content, created_at: new Date().toISOString() });

beforeEach(() => {
  mock.tables.conversations = [];
  mock.tables.messages = [];
  asUser(alice);
});

describe('conversationsApi', () => {
  it('create → list returns the row with normalised flags, newest first', async () => {
    const a = await conversationsApi.create('alice', 'First');
    const b = await conversationsApi.create('alice', 'Second', 'project-1');
    expect(a).toMatchObject({ title: 'First', user_id: 'alice', pinned: false, archived: false, project_id: null });
    expect(b.project_id).toBe('project-1');
    expect(typeof a.id).toBe('string');
    const list = await conversationsApi.list('alice');
    expect(list.map(c => c.id)).toEqual([b.id, a.id]);
  });

  it('list orders pinned first, then by updated_at descending', async () => {
    const a = await conversationsApi.create('alice', 'A');
    const b = await conversationsApi.create('alice', 'B');
    const c = await conversationsApi.create('alice', 'C');
    await conversationsApi.update(a.id, { pinned: true });
    expect((await conversationsApi.list('alice')).map(x => x.id)).toEqual([a.id, c.id, b.id]);
  });

  describe('update (rename / pin / archive / move)', () => {
    it('rename persists the title and returns the stored row with a bumped updated_at', async () => {
      const c = await conversationsApi.create('alice', 'Old');
      const stored = await conversationsApi.update(c.id, { title: 'New' });
      expect(stored.title).toBe('New');
      expect(stored.id).toBe(c.id);
      expect(stored.updated_at > c.updated_at).toBe(true);
      expect(mock.tables.conversations[0].title).toBe('New');
    });

    it('pin / unpin round-trips', async () => {
      const c = await conversationsApi.create('alice', 'Pin me');
      expect((await conversationsApi.update(c.id, { pinned: true })).pinned).toBe(true);
      expect((await conversationsApi.update(c.id, { pinned: false })).pinned).toBe(false);
    });

    it('archive / unarchive round-trips and is returned as a boolean', async () => {
      const c = await conversationsApi.create('alice', 'Archive me');
      expect((await conversationsApi.update(c.id, { archived: true })).archived).toBe(true);
      expect((await conversationsApi.update(c.id, { archived: false })).archived).toBe(false);
    });

    it('move into / out of a project', async () => {
      const c = await conversationsApi.create('alice', 'Move me');
      expect((await conversationsApi.update(c.id, { project_id: 'p1' })).project_id).toBe('p1');
      expect((await conversationsApi.update(c.id, { project_id: null })).project_id).toBeNull();
    });

    it('throws ConversationNotFoundError (404, code not_found) when no row matches', async () => {
      const err = await conversationsApi.update('does-not-exist', { title: 'x' }).catch(e => e);
      expect(err).toBeInstanceOf(ConversationNotFoundError);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ status: 404, code: 'not_found' });
      expect(err.detail).toContain('PGRST116');
    });

    it('wraps other database errors in AppError with the code and message in detail', async () => {
      const c = await conversationsApi.create('alice', 'x');
      const from = mock.client.from;
      mock.client.from = vi.fn(() => {
        const failing = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
        const b: Record<string, unknown> = {};
        for (const k of ['update', 'eq', 'select', 'single']) b[k] = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve(failing).then(res);
        return b;
      }) as typeof from;
      const err = await conversationsApi.update(c.id, { title: 'y' }).catch(e => e);
      mock.client.from = from;
      expect(err).toBeInstanceOf(AppError);
      expect(err).not.toBeInstanceOf(ConversationNotFoundError);
      expect(err.message).toBe('Updating chat failed');
      expect(err.detail).toBe('[57014] canceling statement due to statement timeout');
    });
  });

  describe('remove', () => {
    it('deletes the row and cascades to its messages', async () => {
      const c = await conversationsApi.create('alice', 'Bye');
      await messagesApi.insert({ ...msg('m1', c.id, 'hi'), user_id: 'alice' });
      await conversationsApi.remove(c.id);
      expect(mock.tables.conversations).toHaveLength(0);
      expect(mock.tables.messages).toHaveLength(0);
    });

    it('surfaces database errors as AppError', async () => {
      const from = mock.client.from;
      mock.client.from = vi.fn(() => {
        const b: Record<string, unknown> = {};
        for (const k of ['delete', 'eq']) b[k] = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } }).then(res);
        return b;
      }) as typeof from;
      const err = await conversationsApi.remove('x').catch(e => e);
      mock.client.from = from;
      expect(err).toBeInstanceOf(AppError);
      expect(err.message).toBe('Deleting chat failed');
      expect(err.detail).toContain('[08006]');
    });
  });

  it('touch bumps updated_at so the chat rises to the top', async () => {
    const a = await conversationsApi.create('alice', 'A');
    const b = await conversationsApi.create('alice', 'B');
    expect((await conversationsApi.list('alice')).map(c => c.id)).toEqual([b.id, a.id]);
    await conversationsApi.touch(a.id);
    expect((await conversationsApi.list('alice')).map(c => c.id)).toEqual([a.id, b.id]);
  });
});

describe('messagesApi', () => {
  it('insert → list keeps chronological order and strips base64 from attachments', async () => {
    const c = await conversationsApi.create('alice', 'Chat');
    const withImage = { ...msg('m1', c.id, 'see this'), attachments: [{ id: 'a1', name: 'pic.png', type: 'image/png', size: 3, base64: 'AAAA', kind: 'image' }] } as unknown as Message;
    await messagesApi.insert({ ...withImage, user_id: 'alice' });
    await messagesApi.insert({ ...msg('m2', c.id, 'reply', 'assistant'), user_id: 'alice' });
    const rows = await messagesApi.list(c.id);
    expect(rows.map(m => m.id)).toEqual(['m1', 'm2']);
    expect((rows[0].attachments as unknown as Record<string, unknown>[])[0]).not.toHaveProperty('base64');
    expect(toStoredAttachments(null)).toBeNull();
    expect(toStoredAttachments([])).toBeNull();
  });

  it('updateContent and remove work on own rows; remove([]) is a no-op', async () => {
    const c = await conversationsApi.create('alice', 'Chat');
    await messagesApi.insert({ ...msg('m1', c.id, 'draft'), user_id: 'alice' });
    await messagesApi.updateContent('m1', 'final');
    expect(mock.tables.messages[0].content).toBe('final');
    const from = vi.spyOn(mock.client, 'from');
    await messagesApi.remove([]);
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    await messagesApi.remove(['m1']);
    expect(mock.tables.messages).toHaveLength(0);
  });

  it('insert error is wrapped as AppError("Saving message failed")', async () => {
    // A message for a conversation that does not exist fails the ownership check.
    const err = await messagesApi.insert({ ...msg('m1', 'ghost', 'x'), user_id: 'alice' }).catch(e => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('Saving message failed');
    expect(err.detail).toContain('[42501]');
  });
});

describe('RLS boundary: user B against user A’s data', () => {
  let convId: string;
  beforeEach(async () => {
    asUser(alice);
    const c = await conversationsApi.create('alice', 'Alice’s secret plan');
    convId = c.id;
    await messagesApi.insert({ ...msg('m1', convId, 'top secret'), user_id: 'alice' });
    asUser(bob);
  });

  it('cannot view: list and message reads return no rows', async () => {
    expect(await conversationsApi.list('alice')).toEqual([]);
    expect(await conversationsApi.list('bob')).toEqual([]);
    expect(await messagesApi.list(convId)).toEqual([]);
  });

  it('cannot rename, pin, archive or move: the update matches no row (not_found), nothing changes', async () => {
    for (const patch of [{ title: 'pwned' }, { pinned: true }, { archived: true }, { project_id: 'bobs-project' }]) {
      await expect(conversationsApi.update(convId, patch)).rejects.toBeInstanceOf(ConversationNotFoundError);
    }
    expect(mock.tables.conversations[0]).toMatchObject({ title: 'Alice’s secret plan', pinned: false, archived: false });
    expect(mock.tables.conversations[0].project_id ?? null).toBeNull();
  });

  it('cannot delete: DELETE matches no row, Alice’s chat and messages survive', async () => {
    await conversationsApi.remove(convId);
    expect(mock.tables.conversations).toHaveLength(1);
    expect(mock.tables.messages).toHaveLength(1);
    await messagesApi.remove(['m1']);
    expect(mock.tables.messages).toHaveLength(1);
  });

  it('cannot edit Alice’s messages or write into her conversation', async () => {
    await messagesApi.updateContent('m1', 'tampered');
    expect(mock.tables.messages[0].content).toBe('top secret');
    // Inserting into Alice's chat — whether Bob claims his own id or forges Alice's — is rejected (42501).
    await expect(messagesApi.insert({ ...msg('m2', convId, 'hijack'), user_id: 'bob' })).rejects.toMatchObject({ message: 'Saving message failed' });
    await expect(messagesApi.insert({ ...msg('m3', convId, 'forged'), user_id: 'alice' })).rejects.toMatchObject({ message: 'Saving message failed' });
    expect(mock.tables.messages).toHaveLength(1);
  });

  it('cannot create a conversation owned by someone else (42501)', async () => {
    const err = await conversationsApi.create('alice', 'forged owner').catch(e => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.detail).toContain('[42501]');
    expect(mock.tables.conversations).toHaveLength(1);
  });

  it('signed-out callers get nothing and cannot write', async () => {
    asUser(null);
    expect(await conversationsApi.list('alice')).toEqual([]);
    await expect(conversationsApi.update(convId, { title: 'anon' })).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(conversationsApi.create('alice', 'anon')).rejects.toBeInstanceOf(AppError);
    expect(mock.tables.conversations[0].title).toBe('Alice’s secret plan');
  });

  it('Alice still sees everything intact afterwards', async () => {
    asUser(alice);
    const list = await conversationsApi.list('alice');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Alice’s secret plan');
    expect((await messagesApi.list(convId)).map(m => m.content)).toEqual(['top secret']);
  });
});
