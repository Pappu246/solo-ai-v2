/**
 * Client for the `chat` Edge Function.
 * Handles auth headers, request shaping, error mapping and SSE parsing.
 * The parser is exported separately so it can be unit-tested without a network.
 */
import { supabase, CHAT_FUNCTION_URL, SUPABASE_PUBLISHABLE_KEY } from '../supabase';
import { AppError } from '../errors';
import type { AIModel, Attachment, ChatMessage, ModelInfo } from '../../types';

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new AppError('Your session has expired. Please sign in again.', 401);
  return {
    Authorization: `Bearer ${session.access_token}`,
    ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
    'Content-Type': 'application/json',
  };
}

export async function fetchModels(): Promise<AIModel[]> {
  const res = await fetch(CHAT_FUNCTION_URL, { method: 'GET', headers: await authHeaders() });
  if (!res.ok) throw new AppError('Could not load models', res.status);
  const data = await res.json();
  return Array.isArray(data?.models) ? (data.models as AIModel[]) : [];
}

export interface StreamRequest {
  messages: ChatMessage[];
  /** Explicit model id, or null for Auto routing. */
  model: string | null;
  attachments?: Attachment[];
  signal: AbortSignal;
}

export interface StreamHandle {
  model: ModelInfo;
  /** Async iterator over content deltas. */
  deltas: AsyncGenerator<string, void, void>;
}

/**
 * Parse an OpenAI-style SSE byte stream into content deltas.
 * Accepts any ReadableStream of bytes so tests can feed synthetic chunks.
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const delta = extractDelta(line);
        if (delta) yield delta;
      }
    }
    // Flush any trailing line without a newline.
    const tail = extractDelta(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export function extractDelta(line: string): string | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (!data || data === '[DONE]') return null;
  try {
    const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === 'string' && content ? content : null;
  } catch {
    return null;
  }
}

/** Build the message list sent to the server, appending extracted file text to the last user turn. */
export function buildWireMessages(history: ChatMessage[], attachments?: Attachment[]): ChatMessage[] {
  const wire = history.map(m => ({ role: m.role, content: m.content }));
  const fileContext = attachments
    ?.filter(a => a.extracted_text)
    .map(a => `[File: ${a.name}]\n${a.extracted_text}`)
    .join('\n\n');
  if (fileContext && wire.length) {
    const last = wire[wire.length - 1];
    wire[wire.length - 1] = { ...last, content: `${last.content}\n\n${fileContext}` };
  }
  return wire;
}

export async function streamChat(req: StreamRequest): Promise<StreamHandle> {
  const body: Record<string, unknown> = {
    messages: buildWireMessages(req.messages, req.attachments),
    model: req.model || undefined,
    autoRoute: !req.model,
  };
  const images = req.attachments
    ?.filter(a => a.type === 'image' && a.base64)
    .map(a => ({ base64: a.base64, mime_type: a.mime_type || 'image/jpeg' }));
  if (images?.length) body.images = images;

  const res = await fetch(CHAT_FUNCTION_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let detail: string | undefined;
    try {
      const err = await res.json();
      if (err?.error) { message = String(err.error); detail = message; }
    } catch { /* non-JSON error body */ }
    throw new AppError(message, res.status, detail);
  }
  if (!res.body) throw new AppError('The AI returned an empty response.', 502);

  const model: ModelInfo = {
    id: res.headers.get('X-Model-Used') || req.model || 'auto',
    name: res.headers.get('X-Model-Name') || '',
    category: res.headers.get('X-Route-Category') || 'conversation',
  };
  return { model, deltas: parseSSE(res.body) };
}
