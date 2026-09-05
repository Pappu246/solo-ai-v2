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
const settings = { auto_title: true, preferred_model: null };

beforeEach(() => {
  mock.tables.conversations = [];
  mock.tables.messages = [];
});

describe('useChat flow', () => {
  it('sends a message, streams the reply, and persists exactly one row per turn', async () => {
    vi.stubGlobal('fetch', mockChatFetch('Hello there friend'));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    await act(async () => { await result.current.sendMessage('Hi Solo'); });

    expect(result.current.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.current.messages[1].content).toBe('Hello there friend');
    expect(result.current.messages[1].model_name).toBe('GPT OSS 120B');
    expect(result.current.activeConversation?.title).toBe('Hi Solo');
    expect(mock.tables.messages).toHaveLength(2);
    expect(mock.tables.conversations).toHaveLength(1);
    // Local ids match persisted ids (needed for edit/delete-by-id).
    expect(mock.tables.messages.map(r => r.id)).toEqual(result.current.messages.map(m => m.id));
  });

  it('regenerate replaces the last assistant reply without duplicating rows', async () => {
    vi.stubGlobal('fetch', mockChatFetch('first answer'));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('question'); });
    const firstAssistantId = result.current.messages[1].id;

    vi.stubGlobal('fetch', mockChatFetch('second answer'));
    await act(async () => { await result.current.regenerate(); });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toBe('second answer');
    expect(mock.tables.messages).toHaveLength(2);
    expect(mock.tables.messages.some(r => r.id === firstAssistantId)).toBe(false);
    expect(mock.tables.messages.filter(r => r.role === 'user')).toHaveLength(1);
  });

  it('editing a user message truncates history and regenerates', async () => {
    vi.stubGlobal('fetch', mockChatFetch('a1'));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('q1'); });
    vi.stubGlobal('fetch', mockChatFetch('a2'));
    await act(async () => { await result.current.sendMessage('q2'); });
    expect(result.current.messages).toHaveLength(4);

    vi.stubGlobal('fetch', mockChatFetch('a1-edited'));
    await act(async () => { await result.current.editMessage(result.current.messages[0].id, 'q1 edited'); });

    expect(result.current.messages.map(m => m.content)).toEqual(['q1 edited', 'a1-edited']);
    expect(mock.tables.messages).toHaveLength(2);
    expect(mock.tables.messages[0].content).toBe('q1 edited');
  });

  it('stop keeps the partial reply and saves it', async () => {
    // Hold the stream open after the third word until the test releases it,
    // so Stop is guaranteed to land mid-reply regardless of timer jitter.
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const gate = (index: number) => (index === 3 ? held : Promise.resolve());
    const full = 'one two three four five six seven eight nine ten';
    vi.stubGlobal('fetch', mockChatFetch(full, { gate }));

    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    let done: Promise<void>;
    act(() => { done = result.current.sendMessage('count'); });
    await waitFor(() => expect(result.current.streamingContent).toBe('one two three'));
    act(() => { result.current.stopGeneration(); });
    release();
    await act(async () => { await done; });

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
    const assistant = result.current.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('one two three');
    expect(mock.tables.messages).toHaveLength(2);
    expect(mock.tables.messages[1].content).toBe('one two three');
  });

  it('surfaces a friendly error and allows retry without duplicating the user turn', async () => {
    vi.stubGlobal('fetch', mockChatFetch('', { failStatus: 429 }));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('hello'); });

    expect(result.current.error?.title).toBe('Slow down');
    expect(result.current.canRetry).toBe(true);
    expect(mock.tables.messages).toHaveLength(1);

    vi.stubGlobal('fetch', mockChatFetch('recovered'));
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toBeNull();
    expect(result.current.messages.map(m => m.content)).toEqual(['hello', 'recovered']);
    expect(mock.tables.messages).toHaveLength(2);
  });

  it('archive, pin, rename and delete update local state and storage', async () => {
    vi.stubGlobal('fetch', mockChatFetch('ok'));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));
    await act(async () => { await result.current.sendMessage('x'); });
    const id = result.current.activeConversation!.id;

    await act(async () => { await result.current.renameConversation(id, 'Renamed'); });
    expect(result.current.conversations[0].title).toBe('Renamed');
    expect(mock.tables.conversations[0].title).toBe('Renamed');

    await act(async () => { await result.current.pinConversation(id, true); });
    expect(mock.tables.conversations[0].pinned).toBe(true);

    await act(async () => { await result.current.archiveConversation(id, true); });
    expect(result.current.conversations[0].archived).toBe(true);
    expect(result.current.activeConversation).toBeNull();

    await act(async () => { await result.current.deleteConversation(id); });
    expect(result.current.conversations).toHaveLength(0);
    expect(mock.tables.conversations).toHaveLength(0);
  });
});

describe('useChat — interrupted streams (chat 502 fix)', () => {
  /** Streams raw SSE frames so tests can reproduce a truncated provider reply. */
  function mockRawStream(frames: string[]) {
    return vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ models: [] }), { status: 200 });
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Model-Used': 'gpt-oss-120b', 'X-Model-Name': 'GPT OSS 120B', 'X-Route-Category': 'conversation' } });
    });
  }
  const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

  it('keeps and persists the partial reply when the stream is cut short', async () => {
    vi.stubGlobal('fetch', mockRawStream([delta('partial '), delta('answer')]));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    await act(async () => { await result.current.sendMessage('hi'); });

    expect(result.current.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.current.messages[1].content).toBe('partial answer');
    expect(mock.tables.messages[1].content).toBe('partial answer');
    expect(result.current.error?.message).toBe('The response was interrupted. You can retry to continue.');
    expect(result.current.canRetry).toBe(true);

    // Retrying replaces the truncated reply instead of duplicating the turn.
    vi.stubGlobal('fetch', mockChatFetch('complete answer'));
    await act(async () => { await result.current.retry(); });
    expect(result.current.messages.map(m => m.content)).toEqual(['hi', 'complete answer']);
    expect(mock.tables.messages).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a structured mid-stream provider error without losing text', async () => {
    const errorFrame = 'event: error\ndata: {"error":"AI provider is temporarily unavailable. Please try again.","code":"providers_unavailable","request_id":"req-1"}\n\n';
    vi.stubGlobal('fetch', mockRawStream([delta('so far'), errorFrame]));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    await act(async () => { await result.current.sendMessage('hi'); });

    expect(result.current.messages[1].content).toBe('so far');
    expect(result.current.error?.title).toBe('AI is unavailable');
    expect(result.current.error?.message).toBe('AI provider is temporarily unavailable. Please try again.');
  });

  it('maps a 502 from the function to a useful message, not a generic one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ models: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: 'AI provider is temporarily unavailable. Please try again.', code: 'providers_unavailable', request_id: 'req-2' }), { status: 502 });
    }));
    const { result } = renderHook(() => useChat(user, { settings }));
    await waitFor(() => expect(result.current.conversationsStatus).toBe('ready'));

    await act(async () => { await result.current.sendMessage('hi'); });

    expect(result.current.error?.message).toBe('AI provider is temporarily unavailable. Please try again.');
    expect(result.current.error?.detail).toContain('req-2');
    expect(result.current.canRetry).toBe(true);
    expect(mock.tables.messages).toHaveLength(1);
  });
});
