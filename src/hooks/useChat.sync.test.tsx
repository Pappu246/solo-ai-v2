/**
 * Phase 3 · Chunk 5: state synchronisation after every conversation mutation.
 *
 * Rename / pin / archive / delete / move must leave React state, the sidebar
 * list, the open chat and the database agreeing with each other — without a
 * reload, and identically *after* a reload. The list order asserted here is the
 * exact order `conversationsApi.list` returns, so "what the sidebar shows now"
 * and "what it shows after refresh" are always the same thing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mockChatFetch } from '../test/mockSupabase';
import type { Conversation } from '../types';

const mock = await vi.hoisted(async () => (await import('../test/mockSupabase')).createMockSupabase());
vi.mock('../lib/supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import { useChat, fallbackAfterRemoval, sortConversations } from './useChat';
import { conversationsApi } from '../lib/chat/api';

const user = { id: 'user-1', email: 'test@example.com' } as never;
const settings = { auto_title: true, preferred_model: null };

/** Seed rows in "sidebar order": p1 (pinned), then r1 > r2 > r3 by recency, then an archived one. */
function seed() {
  const row = (id: string, title: string, updated_at: string, extra: Partial<Conversation> = {}) =>
    ({ id, title, user_id: 'user-1', pinned: false, archived: false, project_id: null, created_at: updated_at, updated_at, ...extra });
  mock.tables.conversations = [
    row('r2', 'Recent two', '2026-01-02T00:00:00.000Z'),
    row('p1', 'Pinned one', '2026-01-01T00:00:00.000Z', { pinned: true }),
    row('r3', 'Recent three', '2026-01-01T12:00:00.000Z'),
    row('a1', 'Archived one', '2026-01-04T00:00:00.000Z', { archived: true }),
    row('r1', 'Recent one', '2026-01-03T00:00:00.000Z'),
  ];
  mock.tables.messages = [
    { id: 'm1', conversation_id: 'r1', user_id: 'user-1', role: 'user', content: 'hello from r1', created_at: '2026-01-03T00:00:00.000Z' },
    { id: 'm2', conversation_id: 'r2', user_id: 'user-1', role: 'user', content: 'hello from r2', created_at: '2026-01-02T00:00:00.000Z' },
  ];
}

async function mount() {
  const hook = renderHook(() => useChat(user, { settings }));
  await waitFor(() => expect(hook.result.current.conversationsStatus).toBe('ready'));
  return hook;
}

const ids = (list: Conversation[]) => list.map(c => c.id);
const visibleIds = (list: Conversation[]) => ids(list.filter(c => !c.archived));
/** What a fresh session would load — the ground truth every assertion compares against. */
const persistedIds = async () => ids(await conversationsApi.list('user-1'));

beforeEach(() => {
  seed();
  mock.setUser({ id: 'user-1', email: 'test@example.com' });
  vi.stubGlobal('fetch', mockChatFetch('ok'));
});

describe('sortConversations / fallbackAfterRemoval', () => {
  it('orders pinned first, then most recently updated — same as the database query', async () => {
    const local = sortConversations(mock.tables.conversations as unknown as Conversation[]);
    expect(ids(local)).toEqual(['p1', 'a1', 'r1', 'r2', 'r3']);
    expect(ids(local)).toEqual(await persistedIds());
  });

  it('falls back to the next chat in the same section, then the previous, then nothing', () => {
    const list = sortConversations(mock.tables.conversations as unknown as Conversation[]);
    expect(fallbackAfterRemoval(list, 'r1')?.id).toBe('r2');
    expect(fallbackAfterRemoval(list, 'r3')?.id).toBe('r2'); // last unarchived → previous
    expect(fallbackAfterRemoval(list, 'p1')?.id).toBe('r1'); // only pinned → first recent
    expect(fallbackAfterRemoval(list, 'a1')?.id).toBe('p1'); // last archived chat → top of the active list
    expect(fallbackAfterRemoval(list, 'nope')).toBeNull();
    const only = list.filter(c => c.id === 'r1' || c.id === 'a1');
    expect(fallbackAfterRemoval(only, 'r1')).toBeNull();     // active chats never fall back into the archive → blank chat
    const twoArchived = [...list, { ...list[0], id: 'a2', pinned: false, archived: true, updated_at: '2026-01-05T00:00:00.000Z' }];
    expect(fallbackAfterRemoval(twoArchived, 'a2')?.id).toBe('a1'); // browsing the archive stays in the archive
  });
});

describe('useChat — selection & list stay in sync after mutations', () => {
  it('renaming the open chat keeps it selected and updates header, sidebar row and database together', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await waitFor(() => expect(result.current.messagesStatus).toBe('ready'));
    expect(result.current.messages.map(m => m.content)).toEqual(['hello from r1']);

    await act(async () => { await result.current.renameConversation('r1', '  Quarterly plan  '); });

    expect(result.current.activeConversation?.id).toBe('r1');
    expect(result.current.activeConversation?.title).toBe('Quarterly plan');
    expect(result.current.conversations.find(c => c.id === 'r1')?.title).toBe('Quarterly plan');
    expect(mock.tables.conversations.find(c => c.id === 'r1')?.title).toBe('Quarterly plan');
    // Messages were not reloaded or lost; no error surfaced.
    expect(result.current.messages.map(m => m.content)).toEqual(['hello from r1']);
    expect(result.current.error).toBeNull();
    // The stored updated_at (bumped by the trigger) is mirrored locally so the
    // row sits exactly where a reload would put it.
    expect(result.current.activeConversation?.updated_at).toBe(mock.tables.conversations.find(c => c.id === 'r1')?.updated_at);
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('renaming a non-selected chat never changes the selection', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await act(async () => { await result.current.renameConversation('r3', 'Third'); });
    expect(result.current.activeConversation?.id).toBe('r1');
    expect(result.current.activeConversation?.title).toBe('Recent one');
    expect(result.current.conversations.find(c => c.id === 'r3')?.title).toBe('Third');
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('pin / unpin moves the row between sections, keeps the selection and matches a reload', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r2')!); });

    await act(async () => { await result.current.pinConversation('r2', true); });
    expect(result.current.activeConversation?.id).toBe('r2');
    expect(result.current.activeConversation?.pinned).toBe(true);
    // Just pinned → newest pinned row, above p1 (the database bumps updated_at on the write).
    expect(visibleIds(result.current.conversations)).toEqual(['r2', 'p1', 'r1', 'r3']);
    expect(ids(result.current.conversations)).toEqual(await persistedIds());

    await act(async () => { await result.current.pinConversation('r2', false); });
    expect(result.current.activeConversation?.pinned).toBe(false);
    // Unpinning is also an update, so it becomes the most recent unpinned chat.
    expect(visibleIds(result.current.conversations)).toEqual(['p1', 'r2', 'r1', 'r3']);
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
    expect(result.current.error).toBeNull();
  });

  it('archiving the open chat selects its neighbour instead of a blank screen, and unarchiving restores it', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await waitFor(() => expect(result.current.messagesStatus).toBe('ready'));

    await act(async () => { await result.current.archiveConversation('r1', true); });

    // r1 sat between p1 and r2 → r2 is what the user sees next, with r2's messages loaded.
    expect(result.current.activeConversation?.id).toBe('r2');
    await waitFor(() => expect(result.current.messagesStatus).toBe('ready'));
    expect(result.current.messages.map(m => m.content)).toEqual(['hello from r2']);
    expect(result.current.conversations.find(c => c.id === 'r1')?.archived).toBe(true);
    expect(mock.tables.conversations.find(c => c.id === 'r1')?.archived).toBe(true);
    expect(visibleIds(result.current.conversations)).toEqual(['p1', 'r2', 'r3']);
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
    expect(result.current.error).toBeNull();

    await act(async () => { await result.current.archiveConversation('r1', false); });
    expect(result.current.activeConversation?.id).toBe('r2'); // restoring does not steal focus
    expect(result.current.conversations.find(c => c.id === 'r1')?.archived).toBe(false);
    expect(mock.tables.conversations.find(c => c.id === 'r1')?.archived).toBe(false);
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('archiving a chat that is not open leaves the selection alone', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await act(async () => { await result.current.archiveConversation('r3', true); });
    expect(result.current.activeConversation?.id).toBe('r1');
    expect(result.current.conversations.find(c => c.id === 'r3')?.archived).toBe(true);
  });

  it('deleting the open chat falls back to the next chat with no error', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r2')!); });
    await waitFor(() => expect(result.current.messagesStatus).toBe('ready'));

    await act(async () => { await result.current.deleteConversation('r2'); });

    expect(result.current.activeConversation?.id).toBe('r3');
    expect(result.current.conversations.some(c => c.id === 'r2')).toBe(false);
    expect(mock.tables.conversations.some(c => c.id === 'r2')).toBe(false);
    expect(mock.tables.messages.some(m => m.conversation_id === 'r2')).toBe(false); // cascade
    expect(result.current.error).toBeNull();
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('deleting the last remaining chat shows a blank new chat, not an error', async () => {
    mock.tables.conversations = mock.tables.conversations.filter(c => c.id === 'r1' || c.id === 'a1');
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await act(async () => { await result.current.deleteConversation('r1'); });
    expect(result.current.activeConversation).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.messagesStatus).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(ids(result.current.conversations)).toEqual(['a1']);
  });

  it('deleting a chat that is not open keeps the current one open', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await act(async () => { await result.current.deleteConversation('r3'); });
    expect(result.current.activeConversation?.id).toBe('r1');
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('moving the open chat to a project updates the open chat and the list in one step', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    await act(async () => { await result.current.moveConversation('r1', 'project-9'); });
    expect(result.current.activeConversation?.project_id).toBe('project-9');
    expect(result.current.conversations.find(c => c.id === 'r1')?.project_id).toBe('project-9');
    expect(mock.tables.conversations.find(c => c.id === 'r1')?.project_id).toBe('project-9');
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('a new chat lands at the top of Recent, below pinned chats — exactly where a reload puts it', async () => {
    const { result } = await mount();
    act(() => { result.current.startNewChat(); });
    await act(async () => { await result.current.sendMessage('brand new'); });
    const created = result.current.activeConversation!;
    expect(visibleIds(result.current.conversations)).toEqual(['p1', created.id, 'r1', 'r2', 'r3']);
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('every mutation survives a "refresh": a fresh hook loads the same list and the same titles/flags', async () => {
    const { result, unmount } = await mount();
    await act(async () => { await result.current.renameConversation('r1', 'Renamed one'); });
    await act(async () => { await result.current.pinConversation('r3', true); });
    await act(async () => { await result.current.archiveConversation('r2', true); });
    await act(async () => { await result.current.deleteConversation('p1'); });
    const before = result.current.conversations.map(c => ({ id: c.id, title: c.title, pinned: c.pinned, archived: c.archived }));
    unmount();

    const fresh = await mount();
    const after = fresh.result.current.conversations.map(c => ({ id: c.id, title: c.title, pinned: c.pinned, archived: c.archived }));
    expect(after).toEqual(before);
    expect(after).toEqual([
      { id: 'r3', title: 'Recent three', pinned: true, archived: false },
      { id: 'r2', title: 'Recent two', pinned: false, archived: true },
      { id: 'r1', title: 'Renamed one', pinned: false, archived: false },
      { id: 'a1', title: 'Archived one', pinned: false, archived: true },
    ]);
  });
});

describe('useChat — failures roll back or evict, never desync', () => {
  it('a failed rename restores the stored title and keeps the chat selected', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    const spy = vi.spyOn(conversationsApi, 'update').mockRejectedValueOnce(new Error('network down'));

    await act(async () => { await result.current.renameConversation('r1', 'Will not stick'); });

    await waitFor(() => expect(result.current.conversations.find(c => c.id === 'r1')?.title).toBe('Recent one'));
    expect(result.current.activeConversation?.id).toBe('r1');
    expect(result.current.activeConversation?.title).toBe('Recent one');
    expect(result.current.error?.title).toBeTruthy();
    expect(mock.tables.conversations.find(c => c.id === 'r1')?.title).toBe('Recent one');
    spy.mockRestore();
  });

  it('a failed delete puts the chat back in the list', async () => {
    const { result } = await mount();
    const spy = vi.spyOn(conversationsApi, 'remove').mockRejectedValueOnce(new Error('boom'));
    await act(async () => { await result.current.deleteConversation('r3'); });
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
    expect(result.current.conversations.some(c => c.id === 'r3')).toBe(true);
    expect(result.current.error).not.toBeNull();
    spy.mockRestore();
  });

  it('renaming a chat that was deleted on another device evicts it and moves on without a reload', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.selectConversation(result.current.conversations.find(c => c.id === 'r1')!); });
    // Another session deleted r1 in the meantime.
    mock.tables.conversations = mock.tables.conversations.filter(c => c.id !== 'r1');

    await act(async () => { await result.current.renameConversation('r1', 'Ghost'); });

    expect(result.current.conversations.some(c => c.id === 'r1')).toBe(false);
    expect(result.current.activeConversation?.id).toBe('r2');
    expect(result.current.error?.title).toBe('Not found');
    expect(ids(result.current.conversations)).toEqual(await persistedIds());
  });

  it('a stale response cannot overwrite a newer edit (rename twice quickly)', async () => {
    const { result } = await mount();
    const original = conversationsApi.update.bind(conversationsApi);
    let releaseFirst!: () => void;
    const held = new Promise<void>(r => { releaseFirst = r; });
    let calls = 0;
    const spy = vi.spyOn(conversationsApi, 'update').mockImplementation(async (id, patch) => {
      calls += 1;
      if (calls === 1) { const stored = await original(id, patch); await held; return stored; }
      return original(id, patch);
    });

    let first!: Promise<void>;
    act(() => { first = result.current.renameConversation('r1', 'First'); });
    await act(async () => { await result.current.renameConversation('r1', 'Second'); });
    expect(result.current.conversations.find(c => c.id === 'r1')?.title).toBe('Second');
    releaseFirst();
    await act(async () => { await first; });

    expect(result.current.conversations.find(c => c.id === 'r1')?.title).toBe('Second');
    expect(mock.tables.conversations.find(c => c.id === 'r1')?.title).toBe('Second');
    spy.mockRestore();
  });

  it('user B cannot rename, pin, archive or delete user A’s chat — RLS yields no row, local state is unchanged', async () => {
    // Row belongs to user-1; the session is user-2.
    mock.setUser({ id: 'user-2', email: 'b@example.com' });
    await expect(conversationsApi.update('r1', { title: 'hijacked' })).rejects.toMatchObject({ name: 'ConversationNotFoundError', status: 404 });
    await expect(conversationsApi.update('r1', { pinned: true })).rejects.toMatchObject({ status: 404 });
    await expect(conversationsApi.update('r1', { archived: true })).rejects.toMatchObject({ status: 404 });
    await expect(conversationsApi.remove('r1')).resolves.toBeUndefined(); // DELETE matches 0 rows: silently a no-op
    expect(await conversationsApi.list('user-1')).toEqual([]);               // and A's rows are invisible to B
    const row = mock.tables.conversations.find(c => c.id === 'r1')!;
    expect(row).toMatchObject({ title: 'Recent one', pinned: false, archived: false });
    expect(mock.tables.conversations).toHaveLength(5);
  });
});
