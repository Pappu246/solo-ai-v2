/**
 * Phase 2 hook-in for the chat engine: the context resolver runs before each
 * generation, only its output reaches the Edge Function, sources are persisted
 * on the assistant reply, and Phase 1 behaviour (streaming, stop, retry,
 * regenerate) is unchanged when no resolver is provided.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mockChatFetch } from '../test/mockSupabase';

const mock = await vi.hoisted(async () => (await import('../test/mockSupabase')).createMockSupabase());
vi.mock('../lib/supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import { useChat, type ContextResolver } from './useChat';
import type { ChatContext, KnowledgeSource } from '../types';

const user = { id: 'user-1', email: 'test@example.com' } as never;
const settings = { auto_title: true, preferred_model: null };

beforeEach(() => {
  for (const t of Object.keys(mock.tables)) mock.tables[t] = [];
});

describe('useChat × knowledge', () => {
  it('sends resolved context and persists sources on the assistant reply', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', mockChatFetch('Revenue grew 12%', { onRequest: b => bodies.push(b) }));
    const context: ChatContext = {
      project: { name: 'Finance', instructions: 'Be precise' },
      memories: [{ type: 'preference', content: 'Use percentages' }],
      knowledge: [{ file_id: 'f1', file_name: 'q3.md', chunk_index: 0, content: 'Quarterly revenue grew 12%.' }],
    };
    const sources: KnowledgeSource[] = [{ file_id: 'f1', file_name: 'q3.md', chunk_indexes: [0] }];
    const resolveContext = vi.fn<ContextResolver>(async () => ({ context, sources }));

    const { result } = renderHook(() => useChat(user, { settings, resolveContext }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('How did revenue do?'); });

    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(resolveContext.mock.calls[0][0].query).toBe('How did revenue do?');
    expect(resolveContext.mock.calls[0][0].conversation.id).toBe(result.current.activeConversation!.id);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].context).toEqual(context);
    // No client-side system message is synthesised; the server injects context itself.
    expect((bodies[0].messages as Array<{ role: string }>).every(m => m.role !== 'system')).toBe(true);
    expect(result.current.messages[1].sources).toEqual(sources);
    expect(mock.tables.messages.find(m => m.role === 'assistant')?.sources).toEqual(sources);
  });

  it('sends no context field and no sources when the resolver finds nothing', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', mockChatFetch('Sure', { onRequest: b => bodies.push(b) }));
    const { result } = renderHook(() => useChat(user, { settings, resolveContext: async () => ({}) }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('Write a haiku'); });
    expect(bodies[0]).not.toHaveProperty('context');
    expect(result.current.messages[1].sources ?? null).toBeNull();
    expect(mock.tables.messages.find(m => m.role === 'assistant')).not.toHaveProperty('sources');
  });

  it('still answers when the resolver throws (context is best-effort)', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', mockChatFetch('Answer anyway', { onRequest: b => bodies.push(b) }));
    const { result } = renderHook(() => useChat(user, { settings, resolveContext: async () => { throw new Error('search down'); } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('hello'); });
    expect(result.current.error).toBeNull();
    expect(result.current.messages[1].content).toBe('Answer anyway');
    expect(bodies[0]).not.toHaveProperty('context');
  });

  it('runs the resolver again on regenerate so refreshed knowledge is used', async () => {
    vi.stubGlobal('fetch', mockChatFetch('v1'));
    const resolveContext = vi.fn<ContextResolver>(async () => ({}));
    const { result } = renderHook(() => useChat(user, { settings, resolveContext }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('q'); });
    vi.stubGlobal('fetch', mockChatFetch('v2'));
    await act(async () => { await result.current.regenerate(); });
    expect(resolveContext).toHaveBeenCalledTimes(2);
    expect(result.current.messages[1].content).toBe('v2');
    expect(mock.tables.messages).toHaveLength(2);
  });

  it('creates new chats inside the active project and can move chats between projects', async () => {
    vi.stubGlobal('fetch', mockChatFetch('ok'));
    const onConversationCreated = vi.fn();
    const { result } = renderHook(() => useChat(user, { settings, onConversationCreated }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    act(() => { result.current.startNewChat('project-1'); });
    expect(result.current.activeProjectId).toBe('project-1');
    await act(async () => { await result.current.sendMessage('first in project'); });
    const conv = result.current.activeConversation!;
    expect(conv.project_id).toBe('project-1');
    expect(mock.tables.conversations[0].project_id).toBe('project-1');
    expect(onConversationCreated).toHaveBeenCalledWith(expect.objectContaining({ id: conv.id, project_id: 'project-1' }));

    await act(async () => { await result.current.moveConversation(conv.id, null); });
    expect(result.current.conversations[0].project_id).toBeNull();
    expect(mock.tables.conversations[0].project_id).toBeNull();
    await act(async () => { await result.current.moveConversation(conv.id, 'project-2'); });
    expect(mock.tables.conversations[0].project_id).toBe('project-2');
  });

  it('keeps Phase 1 behaviour when no resolver is configured', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', mockChatFetch('plain reply', { onRequest: b => bodies.push(b) }));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('hi'); });
    expect(bodies[0]).not.toHaveProperty('context');
    expect(result.current.messages[1].content).toBe('plain reply');
    expect(result.current.activeProjectId).toBeNull();
    expect(result.current.activeConversation?.project_id ?? null).toBeNull();
  });
});
