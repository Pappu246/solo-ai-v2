/**
 * Client for the `chat` Edge Function.
 * Handles auth headers, request shaping, error mapping and SSE parsing.
 * The parser is exported separately so it can be unit-tested without a network.
 */
import { supabase, CHAT_FUNCTION_URL, SUPABASE_PUBLISHABLE_KEY } from '../supabase';
import { AppError } from '../errors';
import type { AIModel, Attachment, ChatContext, ChatMessage, ModelInfo } from '../../types';

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
  /** Phase 2: project instructions, memories and retrieved file excerpts. */
  context?: ChatContext;
  signal: AbortSignal;
}

export interface StreamHandle {
  model: ModelInfo;
  /** Async iterator over content deltas. */
  deltas: AsyncGenerator<string, void, void>;
}

/**
 * Parse the chat Edge Function's SSE stream into content deltas.
 *
 * The server speaks a small, explicit protocol:
 *   `data: {"choices":[{"delta":{"content":"…"}}]}`  – a content delta
 *   `event: error` + `data: {error, code, request_id}` – a structured failure
 *   `data: [DONE]`                                   – the response completed
 *
 * `[DONE]` is only written for a clean completion, so a stream that stops
 * early throws `stream_incomplete` *after* the deltas it already yielded —
 * the caller keeps the partial answer and can surface a useful error.
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const parsed = readFrame(frame);
        if (!parsed) continue;
        if (parsed.kind === 'delta') { yield parsed.text; continue; }
        if (parsed.kind === 'done') { completed = true; break; }
        throw toStreamError(parsed.payload);
      }
    }
    // Flush a trailing frame that was not followed by a blank line.
    if (!completed) {
      const tail = readFrame(buffer);
      if (tail?.kind === 'delta') yield tail.text;
      else if (tail?.kind === 'done') completed = true;
      else if (tail?.kind === 'error') throw toStreamError(tail.payload);
    }
    if (!completed) {
      throw new AppError(
        'The response was interrupted.',
        502,
        'The stream ended before the server marked it complete.',
        'stream_incomplete',
      );
    }
  } finally {
    reader.releaseLock();
  }
}

interface ServerErrorPayload { error?: unknown; code?: unknown; request_id?: unknown; message?: unknown }

type Frame =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; payload: ServerErrorPayload };

/** Decode one SSE frame (`event:` + one or more `data:` lines). */
function readFrame(frame: string): Frame | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  const raw = data.join('\n').trim();
  if (!raw) return null;
  if (raw === '[DONE]') return { kind: 'done' };
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  if (event === 'error' || (parsed.error !== undefined && parsed.error !== null)) return { kind: 'error', payload: parsed as ServerErrorPayload };
  const choices = parsed.choices as Array<{ delta?: { content?: unknown } }> | undefined;
  const content = choices?.[0]?.delta?.content;
  return typeof content === 'string' && content ? { kind: 'delta', text: content } : null;
}

/** Turn a server error payload into an AppError (never exposes provider internals). */
function toStreamError(payload: ServerErrorPayload): AppError {
  const nested = (payload.error && typeof payload.error === 'object' ? payload.error : null) as ServerErrorPayload | null;
  const message = String(
    (typeof payload.error === 'string' ? payload.error : '') ||
    (nested && typeof nested.message === 'string' ? nested.message : '') ||
    (typeof payload.message === 'string' ? payload.message : '') ||
    'The response was interrupted.',
  );
  const code = String(payload.code ?? nested?.code ?? '') || undefined;
  const requestId = String(payload.request_id ?? nested?.request_id ?? '') || undefined;
  return new AppError(message, 502, requestId ? `${message} (request ${requestId})` : message, code);
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
  if (req.context) body.context = req.context;

  const res = await fetch(CHAT_FUNCTION_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    // The server returns a safe envelope: { error, code, request_id }.
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    let requestId: string | undefined;
    try {
      const err = await res.json();
      if (err?.error) message = String(err.error);
      if (err?.code) code = String(err.code);
      if (err?.request_id) requestId = String(err.request_id);
    } catch { /* non-JSON error body */ }
    const detail = requestId ? `${message} (request ${requestId})` : message;
    throw new AppError(message, res.status, detail, code);
  }
  if (!res.body) throw new AppError('The AI returned an empty response.', 502, undefined, 'empty_response');

  const model: ModelInfo = {
    id: res.headers.get('X-Model-Used') || req.model || 'auto',
    name: res.headers.get('X-Model-Name') || '',
    category: res.headers.get('X-Route-Category') || 'conversation',
  };
  return { model, deltas: parseSSE(res.body) };
}
