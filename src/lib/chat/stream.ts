/**
 * Client for the `chat` Edge Function.
 * Handles auth headers, request shaping, error mapping and SSE parsing.
 * The parser is exported separately so it can be unit-tested without a network.
 */
import { supabase, CHAT_FUNCTION_URL, SUPABASE_PUBLISHABLE_KEY } from '../supabase';
import { AppError } from '../errors';
import { retryTransient } from '../retry';
import type { AIModel, Attachment, ChatContext, ChatMessage, ModelInfo, ImageSearchImage, WebSearchSource } from '../../types';

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
  // Idempotent GET: safe to retry transient network failures (Phase 11).
  // The chat POST is deliberately NOT retried — a request that reached the
  // server would double-spend usage.
  const headers = await authHeaders();
  const res = await retryTransient(() => fetch(CHAT_FUNCTION_URL, { method: 'GET', headers }));
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
  /** Phase 5: explicitly request web research for this turn. */
  research?: boolean;
  /** Phase 7: opt in to the bounded agent tool loop for this turn. */
  agent?: boolean;
  signal: AbortSignal;
}

export interface StreamHandle {
  model: ModelInfo;
  /** Async iterator over content deltas. */
  deltas: AsyncGenerator<string, void, void>;
  /** Smart Image Search results received while consuming the stream. */
  images: ImageSearchImage[];
  /** Phase 5: web research sources received while consuming the stream. */
  webSources: WebSearchSource[];
}

/**
 * Parse the chat Edge Function's SSE stream into content deltas.
 * Image-search events are consumed separately and collected into `onImageSearch`.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  onImageSearch?: (event: { type: 'started' | 'results' | 'error'; queries?: string[]; images?: ImageSearchImage[]; message?: string }) => void,
  onWebSearch?: (event: { type: 'started' | 'results' | 'error'; query?: string; sources?: WebSearchSource[]; message?: string }) => void,
): AsyncGenerator<string, void, void> {
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
        if (parsed.kind === 'image_search') { onImageSearch?.(parsed.event); continue; }
        if (parsed.kind === 'web_search') { onWebSearch?.(parsed.event); continue; }
        if (parsed.kind === 'delta') { yield parsed.text; continue; }
        if (parsed.kind === 'done') { completed = true; break; }
        throw toStreamError(parsed.payload);
      }
    }
    if (!completed) {
      const tail = readFrame(buffer);
      if (tail?.kind === 'image_search') onImageSearch?.(tail.event);
      else if (tail?.kind === 'web_search') onWebSearch?.(tail.event);
      else if (tail?.kind === 'delta') yield tail.text;
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
  | { kind: 'error'; payload: ServerErrorPayload }
  | { kind: 'image_search'; event: { type: 'started' | 'results' | 'error'; queries?: string[]; images?: ImageSearchImage[]; message?: string } }
  | { kind: 'web_search'; event: { type: 'started' | 'results' | 'error'; query?: string; sources?: WebSearchSource[]; message?: string } };

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
  if (event === 'image_search') {
    const type = parsed.type;
    if (type === 'started' && Array.isArray(parsed.queries)) return { kind: 'image_search', event: { type: 'started', queries: parsed.queries.filter((q): q is string => typeof q === 'string') } };
    if (type === 'results' && Array.isArray(parsed.images)) {
      const images = parsed.images.filter((x): x is ImageSearchImage => Boolean(x && typeof x === 'object' && typeof (x as Record<string, unknown>).url === 'string' && typeof (x as Record<string, unknown>).thumbnail === 'string' && typeof (x as Record<string, unknown>).title === 'string' && typeof (x as Record<string, unknown>).sourceUrl === 'string' && typeof (x as Record<string, unknown>).sourceName === 'string')) as ImageSearchImage[];
      return { kind: 'image_search', event: { type: 'results', images } };
    }
    if (type === 'error' && typeof parsed.message === 'string') return { kind: 'image_search', event: { type: 'error', message: parsed.message } };
    return null;
  }
  if (event === 'web_search') {
    const type = parsed.type;
    if (type === 'started' && typeof parsed.query === 'string') return { kind: 'web_search', event: { type: 'started', query: parsed.query.slice(0, 300) } };
    if (type === 'results' && Array.isArray(parsed.sources)) {
      const sources = parsed.sources.filter((x): x is WebSearchSource => Boolean(x && typeof x === 'object' && typeof (x as Record<string, unknown>).url === 'string' && typeof (x as Record<string, unknown>).title === 'string' && typeof (x as Record<string, unknown>).domain === 'string' && typeof (x as Record<string, unknown>).rank === 'number')) as WebSearchSource[];
      return { kind: 'web_search', event: { type: 'results', sources } };
    }
    if (type === 'error' && typeof parsed.message === 'string') return { kind: 'web_search', event: { type: 'error', message: parsed.message.slice(0, 300) } };
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
/**
 * Server per-message cap (`chat/index.ts` rejects longer content with 413).
 * The appended file context must keep the last message inside it.
 */
export const MAX_MESSAGE_CHARS = 64_000;

/**
 * Phase 10: build the history window that travels with a request.
 *
 * Replaces a fixed `slice(-40)`: turns are taken from the end until either
 * the message count or the character budget is reached, and every non-final
 * message is capped so one giant paste from an old turn cannot evict the rest
 * of the conversation. The newest message (the turn being answered) is always
 * kept intact and never truncated — it is what the model must answer.
 *
 * Older turns are summarised server-side (`buildModelContext`), so breadth
 * here buys continuity without unbounded payloads.
 */
export const HISTORY_MAX_MESSAGES = 200;
export const HISTORY_MAX_CHARS = 160_000;
export const HISTORY_MESSAGE_CHARS = 8_000;

export function selectWireHistory(
  history: ChatMessage[],
  opts: { maxMessages?: number; maxChars?: number; maxMessageChars?: number } = {},
): ChatMessage[] {
  const maxMessages = opts.maxMessages ?? HISTORY_MAX_MESSAGES;
  const maxChars = opts.maxChars ?? HISTORY_MAX_CHARS;
  const perMessage = opts.maxMessageChars ?? HISTORY_MESSAGE_CHARS;
  const out: ChatMessage[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (out.length >= maxMessages) break;
    const isCurrentTurn = out.length === 0;
    let content = history[i].content;
    if (!isCurrentTurn && content.length > perMessage) content = `${content.slice(0, perMessage)}…`;
    if (!isCurrentTurn && chars + content.length > maxChars) break;
    out.unshift({ role: history[i].role, content });
    chars += content.length;
  }
  return out;
}

export function buildWireMessages(history: ChatMessage[], attachments?: Attachment[]): ChatMessage[] {
  const wire = history.map(m => ({ role: m.role, content: m.content }));
  const parts: string[] = [];
  for (const a of attachments ?? []) {
    if (a.extracted_text) parts.push(`[File: ${a.name}]\n${a.extracted_text}`);
    // Knowledge files carry no inline text (their chunks travel in `context`),
    // but the model must still know the file exists even when retrieval found
    // nothing relevant — otherwise it answers as if nothing were attached.
    else if (a.type !== 'image' && a.file_id) parts.push(`[Attached file: ${a.name}]`);
  }
  const fileContext = parts.join('\n\n');
  if (fileContext && wire.length) {
    const last = wire[wire.length - 1];
    let suffix = `\n\n${fileContext}`;
    // Keep the whole message inside the server's per-message cap so a large
    // attachment degrades to a truncated excerpt instead of a 413.
    const room = MAX_MESSAGE_CHARS - last.content.length;
    if (room <= 1) suffix = '';
    else if (suffix.length > room) suffix = `${suffix.slice(0, room - 1)}…`;
    wire[wire.length - 1] = { ...last, content: `${last.content}${suffix}` };
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
  if (req.research) body.research = true;
  if (req.agent) body.agent = true;
  if (req.context) body.context = req.context;

  const res = await fetch(CHAT_FUNCTION_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
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
  const imageResults: ImageSearchImage[] = [];
  const webSources: WebSearchSource[] = [];
  const deltas = parseSSE(res.body, event => {
    if (event.type === 'results' && event.images?.length) imageResults.push(...event.images);
  }, event => {
    if (event.type === 'results' && event.sources?.length) webSources.push(...event.sources);
  });
  return { model, deltas, images: imageResults, webSources };
}
