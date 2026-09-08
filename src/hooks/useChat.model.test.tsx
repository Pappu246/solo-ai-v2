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

import { useChat } from './useChat';

const user = { id: 'user-1', email: 'test@example.com' } as never;

beforeEach(() => {
  mock.tables.conversations = [];
  mock.tables.messages = [];
});

describe('useChat per-conversation model choice', () => {
  it('sends the selected model in the API request and persists it on a new chat', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', mockChatFetch('ok', { onRequest: b => bodies.push(b) }));
    const { result } = renderHook(() => useChat(user, { settings: { auto_title: true, preferred_model: null } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    // Pick a model on the blank chat, then send the first message.
    act(() => result.current.selectModel('claude-sonnet-5'));
    await act(async () => { await result.current.sendMessage('hi'); });

    // The very first request already uses the picked model (not Auto).
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe('claude-sonnet-5');
    expect(bodies[0].autoRoute).toBe(false);
    // And the choice is persisted on the conversation row.
    expect(result.current.activeConversation?.model_id).toBe('claude-sonnet-5');
    expect(mock.tables.conversations[0].model_id).toBe('claude-sonnet-5');
  });

  it('sends autoRoute for Auto and no model field', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', mockChatFetch('ok', { onRequest: b => bodies.push(b) }));
    const { result } = renderHook(() => useChat(user, { settings: { auto_title: true, preferred_model: null } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('hi'); });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBeUndefined();
    expect(bodies[0].autoRoute).toBe(true);
    expect(result.current.activeConversation?.model_id ?? null).toBeNull();
  });

  it('persists a model picked on an existing chat and uses it for the next request', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', mockChatFetch('ok', { onRequest: b => bodies.push(b) }));
    const { result } = renderHook(() => useChat(user, { settings: { auto_title: true, preferred_model: null } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('first'); });
    const id = result.current.activeConversation!.id;

    act(() => result.current.selectModel('gemini-3.7-flash'));
    expect(result.current.selectedModel).toBe('gemini-3.7-flash');
    expect(result.current.activeConversation?.model_id).toBe('gemini-3.7-flash');

    // The write reaches storage (optimistic first, reconciled after).
    await waitFor(() => expect(mock.tables.conversations.find(r => r.id === id)?.model_id).toBe('gemini-3.7-flash'));

    await act(async () => { await result.current.sendMessage('second'); });
    expect(bodies[bodies.length - 1].model).toBe('gemini-3.7-flash');
    expect(bodies[bodies.length - 1].autoRoute).toBe(false);
  });

  it('restores each chat’s own model when switching conversations', async () => {
    vi.stubGlobal('fetch', mockChatFetch('ok'));
    const { result } = renderHook(() => useChat(user, { settings: { auto_title: true, preferred_model: null } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    // Chat A: created with an explicit model.
    act(() => result.current.selectModel('claude-sonnet-5'));
    await act(async () => { await result.current.sendMessage('alpha'); });
    const a = result.current.activeConversation!;

    // Chat B: left on Auto.
    act(() => result.current.startNewChat());
    expect(result.current.selectedModel).toBeNull();
    await act(async () => { await result.current.sendMessage('beta'); });
    expect(result.current.activeConversation?.model_id ?? null).toBeNull();

    // Switching back and forth follows each chat's saved choice.
    await act(async () => { await result.current.selectConversation(a); });
    expect(result.current.selectedModel).toBe('claude-sonnet-5');
    const b = result.current.conversations.find(c => c.id !== a.id)!;
    await act(async () => { await result.current.selectConversation(b); });
    expect(result.current.selectedModel).toBeNull();
    await act(async () => { await result.current.selectConversation(a); });
    expect(result.current.selectedModel).toBe('claude-sonnet-5');
  });

  it('re-uses an explicit chat model when the same value is re-picked (no extra write)', async () => {
    vi.stubGlobal('fetch', mockChatFetch('ok'));
    const { result } = renderHook(() => useChat(user, { settings: { auto_title: true, preferred_model: null } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    act(() => result.current.selectModel('claude-sonnet-5'));
    await act(async () => { await result.current.sendMessage('hi'); });

    const before = mock.tables.conversations[0];
    act(() => result.current.selectModel('claude-sonnet-5')); // no-op
    expect(result.current.selectedModel).toBe('claude-sonnet-5');
    expect(mock.tables.conversations[0]).toBe(before);
  });

  it('keeps an explicit chat model when the global preference changes', async () => {
    vi.stubGlobal('fetch', mockChatFetch('ok'));
    const initial = { auto_title: true, preferred_model: null as string | null };
    const { result, rerender } = renderHook(({ settings }) => useChat(user, { settings }), { initialProps: { settings: initial } });
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('hi'); });
    act(() => result.current.selectModel('claude-sonnet-5'));

    // A different global default must not override the chat's own choice…
    rerender({ settings: { auto_title: true, preferred_model: 'gpt-5.2' } });
    expect(result.current.selectedModel).toBe('claude-sonnet-5');

    // …but a chat without its own choice follows the global preference.
    act(() => result.current.startNewChat());
    expect(result.current.selectedModel).toBe('gpt-5.2');
  });

  it('resets to the global preference when starting a new chat', async () => {
    vi.stubGlobal('fetch', mockChatFetch('ok'));
    const { result } = renderHook(() => useChat(user, { settings: { auto_title: true, preferred_model: 'deepseek-v4-pro' } }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    act(() => result.current.selectModel('claude-sonnet-5'));
    act(() => result.current.startNewChat());
    expect(result.current.selectedModel).toBe('deepseek-v4-pro');
  });
});
