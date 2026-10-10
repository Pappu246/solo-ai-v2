import { describe, it, expect } from 'vitest';
import { extractDelta, parseSSE, buildWireMessages, selectWireHistory, HISTORY_MAX_MESSAGES, HISTORY_MAX_CHARS, HISTORY_MESSAGE_CHARS, MAX_MESSAGE_CHARS } from './stream';
import { AppError, toFriendlyError } from '../errors';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) { for (const c of chunks) controller.enqueue(enc.encode(c)); controller.close(); },
  });
}

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const d of gen) out.push(d);
  return out;
}

async function collectPartial(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  let error: AppError | null = null;
  try { for await (const d of gen) out.push(d); }
  catch (e) { error = e as AppError; }
  return { text: out.join(''), error };
}

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

const image = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://cdn.example.com/full.jpg',
  thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=test',
  title: 'Golden retriever puppy',
  sourceUrl: 'https://example.com/photo',
  sourceName: 'example.com',
  ...overrides,
});

const webSource = (overrides: Record<string, unknown> = {}) => ({
  title: 'Supabase Edge Functions',
  url: 'https://supabase.com/docs/functions',
  domain: 'supabase.com',
  snippet: 'Run TypeScript functions at the edge.',
  rank: 1,
  ...overrides,
});

describe('extractDelta', () => {
  it('extracts OpenAI-style content deltas', () => {
    expect(extractDelta('data: {"choices":[{"delta":{"content":"Hi"}}]}')).toBe('Hi');
  });
  it('ignores [DONE], empty, non-data and malformed lines', () => {
    expect(extractDelta('data: [DONE]')).toBeNull();
    expect(extractDelta('data: ')).toBeNull();
    expect(extractDelta(': keep-alive')).toBeNull();
    expect(extractDelta('data: {not json')).toBeNull();
    expect(extractDelta('data: {"choices":[{"delta":{}}]}')).toBeNull();
  });
});

describe('parseSSE', () => {
  it('reassembles events split across chunk boundaries', async () => {
    const chunks = ['data: {"choices":[{"delta":{"con', 'tent":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n', '\ndata: [DONE]\n\n'];
    expect((await collect(parseSSE(streamOf(chunks)))).join('')).toBe('Hello');
  });
  it('flushes a trailing event without a newline', async () => {
    const out = await collect(parseSSE(streamOf(['data: {"choices":[{"delta":{"content":"tail"}}]}\n\ndata: [DONE]\n\n'])));
    expect(out).toEqual(['tail']);
  });
  it('ignores comments and keep-alive frames', async () => {
    const out = await collect(parseSSE(streamOf([': ping\n\n', delta('hi'), 'data: {not json}\n\n', 'data: [DONE]\n\n'])));
    expect(out).toEqual(['hi']);
  });
  it('handles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"नमस्ते"}}]}\n\ndata: [DONE]\n\n');
    const a = bytes.slice(0, 40), b = bytes.slice(40);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(a); c.enqueue(b); c.close(); } });
    expect((await collect(parseSSE(stream))).join('')).toBe('नमस्ते');
  });
  it('extracts real image results from image_search SSE events', async () => {
    const received: Array<{ type: string; images?: unknown[] }> = [];
    const out = await collect(parseSSE(streamOf([
      'event: image_search\ndata: {"type":"started","queries":["golden retriever puppies"]}\n\n',
      delta('Here are the photos.'),
      `event: image_search\ndata: ${JSON.stringify({ type: 'results', images: [image(), image({ url: 'https://cdn.example.com/full-2.jpg' })] })}\n\n`,
      'data: [DONE]\n\n',
    ]), event => { if (event.type === 'results') received.push(event); }));
    expect(out).toEqual(['Here are the photos.']);
    expect(received).toHaveLength(1);
    expect(received[0].images).toHaveLength(2);
    expect(received[0].images?.[0]).toMatchObject({
      url: 'https://cdn.example.com/full.jpg',
      thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=test',
    });
  });
  it('passes structurally valid image results through for downstream gallery validation', async () => {
    const received: Array<unknown> = [];
    await collect(parseSSE(streamOf([
      `event: image_search\ndata: ${JSON.stringify({ type: 'results', images: [image({ thumbnail: '' }), image()] })}\n\n`,
      'data: [DONE]\n\n',
    ]), event => { if (event.type === 'results') received.push(...(event.images ?? [])); }));
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ thumbnail: '' });
  });

  it('collects web research sources from web_search SSE events', async () => {
    const events: Array<{ type: string; sources?: unknown[] }> = [];
    const out = await collect(parseSSE(streamOf([
      'event: web_search\ndata: {"type":"started","query":"supabase edge functions"}\n\n',
      delta('According to the docs,'),
      `event: web_search\ndata: ${JSON.stringify({ type: 'results', sources: [webSource(), webSource({ url: 'https://deno.com/deploy', domain: 'deno.com', rank: 2 })] })}\n\n`,
      'data: [DONE]\n\n',
    ]), undefined, event => { if (event.type === 'results') events.push(event); }));
    expect(out).toEqual(['According to the docs,']);
    expect(events).toHaveLength(1);
    expect(events[0].sources).toHaveLength(2);
    expect(events[0].sources?.[0]).toMatchObject({ domain: 'supabase.com', rank: 1 });
  });

  it('drops malformed web sources and surfaces research errors', async () => {
    const results: Array<{ type: string; sources?: unknown[]; message?: string }> = [];
    await collect(parseSSE(streamOf([
      `event: web_search\ndata: ${JSON.stringify({ type: 'results', sources: [webSource({ url: 42 }), webSource()] })}\n\n`,
      'event: web_search\ndata: {"type":"error","message":"Web research returned no sources right now."}\n\n',
      'data: [DONE]\n\n',
    ]), undefined, event => results.push(event)));
    expect(results[0].sources).toHaveLength(1);
    expect(results[1]).toMatchObject({ type: 'error', message: 'Web research returned no sources right now.' });
  });
});

describe('parseSSE — interrupted and failed streams', () => {
  it('raises a structured error for a mid-stream provider failure and keeps the partial text', async () => {
    const errorFrame = 'event: error\ndata: {"error":"AI provider is temporarily unavailable. Please try again.","code":"providers_unavailable","request_id":"req-42"}\n\n';
    const { text, error } = await collectPartial(parseSSE(streamOf([delta('partial '), delta('answer'), errorFrame])));
    expect(text).toBe('partial answer');
    expect(error?.code).toBe('providers_unavailable');
    expect(error?.detail).toContain('req-42');
    expect(toFriendlyError(error).message).toBe('AI provider is temporarily unavailable. Please try again.');
  });

  it('flags a stream that ends without [DONE] as stream_incomplete', async () => {
    const { text, error } = await collectPartial(parseSSE(streamOf([delta('half an '), delta('answer')])));
    expect(text).toBe('half an answer');
    expect(error?.code).toBe('stream_incomplete');
    expect(toFriendlyError(error).message).toBe('The response was interrupted. You can retry to continue.');
    expect(toFriendlyError(error).retryable).toBe(true);
  });

  it('flags an empty stream as incomplete rather than silently succeeding', async () => {
    const { text, error } = await collectPartial(parseSSE(streamOf([])));
    expect(text).toBe('');
    expect(error?.code).toBe('stream_incomplete');
  });

  it('never surfaces provider internals from an error frame', async () => {
    const frame = 'event: error\ndata: {"error":"The AI returned an empty response. Please try again.","code":"empty_response","request_id":"req-7"}\n\n';
    const { error } = await collectPartial(parseSSE(streamOf([frame])));
    expect(error?.message).not.toMatch(/groq|openai|anthropic|api[_ ]?key/i);
    expect(toFriendlyError(error).title).toBe('Empty response');
  });
});

describe('buildWireMessages', () => {
  it('appends extracted file text to the last user message only', () => {
    const wire = buildWireMessages(
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'summarise' }],
      [{ id: '1', name: 'notes.txt', type: 'txt', size: 3, extracted_text: 'abc' }],
    );
    expect(wire[0].content).toBe('a');
    expect(wire[2].content).toBe('summarise\n\n[File: notes.txt]\nabc');
  });
  it('does not mutate the input history', () => {
    const history = [{ role: 'user' as const, content: 'x' }];
    buildWireMessages(history, [{ id: '1', name: 'f', type: 'txt', size: 1, extracted_text: 'y' }]);
    expect(history[0].content).toBe('x');
  });
  it('names knowledge attachments that have no inline text', () => {
    const wire = buildWireMessages(
      [{ role: 'user', content: 'review this' }],
      [{ id: '1', name: 'contract.pdf', type: 'pdf', size: 10, file_id: 'kf-1', status: 'ready' }],
    );
    expect(wire[0].content).toBe('review this\n\n[Attached file: contract.pdf]');
  });
  it('combines inline text and knowledge attachments without duplicating', () => {
    const wire = buildWireMessages(
      [{ role: 'user', content: 'compare' }],
      [
        { id: '1', name: 'notes.txt', type: 'txt', size: 3, extracted_text: 'abc' },
        { id: '2', name: 'report.pdf', type: 'pdf', size: 9, file_id: 'kf-2', status: 'ready' },
        { id: '3', name: 'photo.png', type: 'image', size: 9, base64: 'AAA' },
      ],
    );
    expect(wire[0].content).toContain('[File: notes.txt]');
    expect(wire[0].content).toContain('[Attached file: report.pdf]');
    expect(wire[0].content).not.toContain('photo.png'); // images travel as images
  });
  it('leaves the message alone when there is nothing to add', () => {
    const wire = buildWireMessages([{ role: 'user', content: 'hi' }], []);
    expect(wire[0].content).toBe('hi');
    expect(buildWireMessages([{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }]);
  });
  it('truncates the appended file context so the message stays under the server cap', () => {
    const big = 'x'.repeat(MAX_MESSAGE_CHARS * 2);
    const wire = buildWireMessages(
      [{ role: 'user', content: 'summarise' }],
      [{ id: '1', name: 'huge.txt', type: 'txt', size: big.length, extracted_text: big }],
    );
    expect(wire[0].content.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(wire[0].content.startsWith('summarise')).toBe(true);
    expect(wire[0].content).toContain('[File: huge.txt]');
    expect(wire[0].content.endsWith('…')).toBe(true);
  });
  it('does not append anything when the message alone fills the cap', () => {
    const wire = buildWireMessages(
      [{ role: 'user', content: 'y'.repeat(MAX_MESSAGE_CHARS) }],
      [{ id: '1', name: 'n.txt', type: 'txt', size: 3, extracted_text: 'abc' }],
    );
    expect(wire[0].content).toBe('y'.repeat(MAX_MESSAGE_CHARS));
  });
});

describe('selectWireHistory (Phase 10)', () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => ({
    role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
    content: `turn-${i + 1}`,
  }));

  it('keeps a short conversation fully intact', () => {
    const out = selectWireHistory(turns(20));
    expect(out).toHaveLength(20);
    expect(out[0].content).toBe('turn-1');
    expect(out[19].content).toBe('turn-20');
  });

  it('windows a long conversation by count, keeping the newest turns', () => {
    const out = selectWireHistory(turns(500), { maxMessages: 30, maxChars: 1_000_000 });
    expect(out).toHaveLength(30);
    expect(out[out.length - 1].content).toBe('turn-500');
    expect(out[0].content).toBe('turn-471');
  });

  it('windows by characters so old turns cannot balloon the request', () => {
    const history = [
      { role: 'user' as const, content: 'a'.repeat(90_000) },
      ...turns(10),
    ];
    const out = selectWireHistory(history, { maxChars: 100_000, maxMessageChars: 8_000 });
    // The oversized first turn is truncated to the per-message cap, so it
    // no longer evicts everything else by itself.
    expect(out[0].content.length).toBe(HISTORY_MESSAGE_CHARS + 1);
    expect(out[out.length - 1].content).toBe('turn-10');
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(100_000);
  });

  it('always keeps the current turn intact, even when it alone exceeds the budget', () => {
    const history = [...turns(5), { role: 'user' as const, content: 'z'.repeat(500_000) }];
    const out = selectWireHistory(history, { maxChars: 10_000 });
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('z'.repeat(500_000));
  });

  it('respects the default budgets', () => {
    const huge = Array.from({ length: 400 }, (_, i) => ({ role: 'user' as const, content: `m${i} ${'q'.repeat(500)}` }));
    const out = selectWireHistory(huge);
    expect(out.length).toBeLessThanOrEqual(HISTORY_MAX_MESSAGES);
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
  });

  it('never mutates the input history', () => {
    const history = turns(3);
    selectWireHistory(history);
    expect(history[0].content).toBe('turn-1');
  });
});
