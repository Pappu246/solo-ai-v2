import { describe, it, expect } from 'vitest';
import { extractDelta, parseSSE, buildWireMessages } from './stream';
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

/** Collect deltas *and* the error that ended the stream (if any). */
async function collectPartial(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  let error: AppError | null = null;
  try { for await (const d of gen) out.push(d); }
  catch (e) { error = e as AppError; }
  return { text: out.join(''), error };
}

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

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
});
