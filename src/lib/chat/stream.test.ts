import { describe, it, expect } from 'vitest';
import { extractDelta, parseSSE, buildWireMessages } from './stream';

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
    const out = await collect(parseSSE(streamOf(['data: {"choices":[{"delta":{"content":"tail"}}]}'])));
    expect(out).toEqual(['tail']);
  });
  it('handles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"नमस्ते"}}]}\n');
    const a = bytes.slice(0, 40), b = bytes.slice(40);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(a); c.enqueue(b); c.close(); } });
    expect((await collect(parseSSE(stream))).join('')).toBe('नमस्ते');
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
