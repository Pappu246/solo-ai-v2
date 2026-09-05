/**
 * Provider layer for the Solo AI `chat` Edge Function.
 *
 * Everything in this module is dependency-injected (`fetchImpl`, `env`, timing
 * guards) and free of remote imports so it can be type-checked and unit-tested
 * offline with `deno test supabase/functions/chat/providers_test.ts`.
 *
 * Responsibilities:
 *  - the model catalog (+ aliases for retired ids so saved preferences keep working)
 *  - building provider requests (header-based auth only — never keys in URLs)
 *  - classifying failures into "try the next provider" vs "this request is broken"
 *  - normalising every provider's SSE dialect into a single event stream with
 *    connect / idle / max-duration guards and explicit incompleteness detection
 *  - producing safe, structured errors: user-facing text never contains an
 *    upstream response body, a provider hint or an API key.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type ProviderId = "openai" | "anthropic" | "google" | "groq" | "deepseek";

export interface ModelSpec {
  id: string;
  name: string;
  provider: ProviderId;
  category: string;
  speed: number;
  quality: number;
  cost: number;
  free: boolean;
  context_length: number;
  supports_vision: boolean;
  supports_tools: boolean;
  tag?: string;
  /** Provider-side id when it differs from the public id (never sent to clients). */
  provider_model?: string;
}

export type Message = { role: "user" | "assistant" | "system"; content: string | Array<Record<string, unknown>> };
export type Image = { base64: string; mime_type: string };

/** Stable machine codes shared with the browser (see src/lib/errors.ts). */
export type FailureCode =
  | "model_unavailable"
  | "provider_not_configured"
  | "provider_auth"
  | "provider_payment"
  | "provider_timeout"
  | "rate_limited"
  | "provider_error"
  | "network_error"
  | "invalid_request"
  | "context_length_exceeded"
  | "content_filtered"
  | "images_unsupported"
  | "empty_response"
  | "stream_incomplete"
  | "providers_unavailable";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: FailureCode; status: number; detail: string };

export type EnvReader = (name: string) => string | undefined;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── Model catalog ───────────────────────────────────────────────────────────

/**
 * Groq's `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` were shut down
 * (Groq deprecation notice, shutdown 2026-08-16) and were the main source of
 * the production 502s: every request routed to them returned a 4xx that also
 * stopped the fallback loop. They are removed from the catalog and kept alive
 * as aliases so existing `preferred_model` / `conversations.model_id` rows
 * silently reconcile onto the recommended replacements.
 */
export const MODELS: readonly ModelSpec[] = [
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", category: "conversation", speed: 4, quality: 5, cost: 4, free: false, context_length: 128000, supports_vision: true, supports_tools: true, tag: "Vision" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", category: "fast", speed: 5, quality: 4, cost: 2, free: false, context_length: 128000, supports_vision: true, supports_tools: true },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic", category: "coding", speed: 4, quality: 5, cost: 4, free: false, context_length: 1000000, supports_vision: true, supports_tools: true, tag: "Top" },
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", category: "reasoning", speed: 3, quality: 5, cost: 5, free: false, context_length: 1000000, supports_vision: true, supports_tools: true },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic", category: "fast", speed: 5, quality: 4, cost: 2, free: false, context_length: 200000, supports_vision: true, supports_tools: true },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google", category: "research", speed: 5, quality: 5, cost: 2, free: false, context_length: 1048576, supports_vision: true, supports_tools: true, tag: "Latest" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", provider: "google", category: "reasoning", speed: 4, quality: 5, cost: 4, free: false, context_length: 1048576, supports_vision: true, supports_tools: true, tag: "Pro", provider_model: "gemini-3.1-pro-preview" },
  { id: "gpt-oss-20b", name: "GPT OSS 20B", provider: "groq", category: "fast", speed: 5, quality: 4, cost: 1, free: false, context_length: 131072, supports_vision: false, supports_tools: true, tag: "Fast", provider_model: "openai/gpt-oss-20b" },
  { id: "gpt-oss-120b", name: "GPT OSS 120B", provider: "groq", category: "conversation", speed: 5, quality: 5, cost: 2, free: false, context_length: 131072, supports_vision: false, supports_tools: true, tag: "Best", provider_model: "openai/gpt-oss-120b" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", category: "reasoning", speed: 4, quality: 5, cost: 2, free: false, context_length: 1000000, supports_vision: false, supports_tools: true, tag: "Latest" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", category: "fast", speed: 5, quality: 4, cost: 1, free: false, context_length: 1000000, supports_vision: false, supports_tools: true, tag: "Fast" },
];

/** Retired / provider-native ids → the catalog id that replaces them. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  // Retired Groq Llama models (shutdown 2026-08-16) → recommended replacements.
  "llama-3.3-70b": "gpt-oss-120b",
  "llama-3.3-70b-versatile": "gpt-oss-120b",
  "llama-3.1-8b": "gpt-oss-20b",
  "llama-3.1-8b-instant": "gpt-oss-20b",
  // Provider-native ids that users may have pasted into settings.
  "openai/gpt-oss-120b": "gpt-oss-120b",
  "openai/gpt-oss-20b": "gpt-oss-20b",
  "gemini-3.1-pro-preview": "gemini-3.1-pro",
};

/** Catalog as sent to the browser (internal fields stripped). */
export function publicModels(): Array<Omit<ModelSpec, "provider_model">> {
  return MODELS.map((model) => {
    const copy: Partial<ModelSpec> = { ...model };
    delete copy.provider_model;
    return copy as Omit<ModelSpec, "provider_model">;
  });
}

/** Resolve a requested id (possibly a retired alias) to a live catalog entry. */
export function resolveModel(id: string | null | undefined): ModelSpec | null {
  if (!id) return null;
  const direct = MODELS.find(m => m.id === id);
  if (direct) return direct;
  const alias = MODEL_ALIASES[id];
  return alias ? MODELS.find(m => m.id === alias) ?? null : null;
}

/** True when the id is known but only through the retired-model alias table. */
export function isAliasedModel(id: string): boolean {
  return !MODELS.some(m => m.id === id) && Boolean(MODEL_ALIASES[id]);
}

/** Ordered fallback chain: the chosen model first, then healthy alternatives. */
export function fallbackChain(primary: ModelSpec, hasImages: boolean): ModelSpec[] {
  const ids = hasImages
    ? ["gemini-3.7-flash", "gpt-4o", "claude-haiku-4-5-20251001"]
    : ["gpt-oss-120b", "gemini-3.7-flash", "deepseek-v4-flash", "gpt-4o-mini"];
  const chain = [primary];
  for (const id of ids) {
    const model = resolveModel(id);
    if (!model) continue;
    if (hasImages && !model.supports_vision) continue;
    if (chain.some(m => m.id === model.id)) continue;
    chain.push(model);
  }
  return chain;
}

// ── Secrets & redaction ─────────────────────────────────────────────────────

export const API_KEY_ENV: Readonly<Record<ProviderId, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/** Reads Deno env without throwing when the permission is not granted (tests). */
export const denoEnv: EnvReader = (name) => {
  try { return Deno.env.get(name); } catch { return undefined; }
};

export function apiKeyFor(provider: ProviderId, env: EnvReader = denoEnv): string {
  return (env(API_KEY_ENV[provider]) || "").trim();
}

const KEY_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgsk_[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{10,}/g,
  /\bxai-[A-Za-z0-9_-]{8,}/g,
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
  /((?:api[-_]?key|key|access[-_]?token|authorization)["'\s:=]+)[A-Za-z0-9._-]{8,}/gi,
];

/**
 * Strip anything that looks like a credential from text that may end up in a
 * log line. `secrets` are the concrete values in play for this request.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined> = []): string {
  let out = text ?? "";
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, (_match, prefix?: string) => `${prefix ?? ""}[redacted]`);
  }
  return out;
}

// ── Errors ──────────────────────────────────────────────────────────────────

const RETRYABLE_CODES = new Set<FailureCode>([
  "model_unavailable",
  "provider_not_configured",
  "provider_auth",
  "provider_payment",
  "provider_timeout",
  "rate_limited",
  "provider_error",
  "network_error",
  "empty_response",
]);

/** HTTP status returned to the browser for a given failure code. */
export function statusForCode(code: FailureCode): number {
  switch (code) {
    case "invalid_request":
    case "content_filtered":
    case "images_unsupported":
      return 400;
    case "context_length_exceeded":
      return 413;
    case "rate_limited":
      return 429;
    case "provider_timeout":
      return 504;
    default:
      return 502;
  }
}

/** Safe, user-facing sentence for a failure code. Never mentions a provider. */
export function userMessage(code: FailureCode): string {
  switch (code) {
    case "model_unavailable":
      return "The selected model is not available right now. Switch to Auto or pick another model.";
    case "rate_limited":
      return "The AI is rate limiting requests right now. Wait a moment and try again.";
    case "provider_timeout":
      return "The AI took too long to respond. Please try again.";
    case "invalid_request":
      return "The request could not be processed.";
    case "context_length_exceeded":
      return "This conversation is too long for the selected model. Start a new chat or shorten your message.";
    case "content_filtered":
      return "This request was blocked by the model's content policy.";
    case "images_unsupported":
      return "The selected model cannot read images. Switch to Auto or pick a vision model.";
    case "empty_response":
      return "The AI returned an empty response. Please try again.";
    case "stream_incomplete":
      return "The response was interrupted before it finished.";
    default:
      return "AI provider is temporarily unavailable. Please try again.";
  }
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly code: FailureCode;
  readonly retryable: boolean;
  /** Redacted diagnostic detail — server logs only, never sent to a browser. */
  readonly detail: string;

  constructor(init: { provider: string; code: FailureCode; status?: number; detail?: string; retryable?: boolean }) {
    // The message itself is safe: code + provider, no upstream body.
    super(`${init.provider}: ${init.code}`);
    this.name = "ProviderError";
    this.provider = init.provider;
    this.code = init.code;
    this.status = init.status ?? statusForCode(init.code);
    this.retryable = init.retryable ?? RETRYABLE_CODES.has(init.code);
    this.detail = init.detail ?? "";
  }
}

const MODEL_MARKERS = [
  "model_not_found",
  "model_decommissioned",
  "model_terminated",
  "model not found",
  "does not exist",
  "unknown model",
  "invalid model",
  "unsupported model",
  "model is not supported",
  "is not supported",
  "decommission",
  "deprecated",
  "no longer supported",
  "no longer available",
  "has been retired",
  "not available for",
];
const CONTEXT_MARKERS = ["context_length_exceeded", "maximum context", "context window", "too many tokens", "reduce the length", "string too long", "prompt is too long"];
const POLICY_MARKERS = ["content_policy", "content policy", "content_filter", "safety", "blocked by", "prohibited_content", "responsible ai"];
const QUOTA_MARKERS = ["quota", "rate limit", "rate_limit", "too many requests", "insufficient_quota"];

/**
 * Decide whether a non-2xx provider response should move us to the next
 * provider (transient / model-specific) or stop the loop (the request itself
 * is broken and would fail everywhere).
 */
export function classifyHttpFailure(status: number, body: string): { code: FailureCode; retryable: boolean } {
  const text = (body || "").toLowerCase();
  const has = (markers: string[]) => markers.some(m => text.includes(m));
  const code: FailureCode = (() => {
    if (status === 429) return "rate_limited";
    if (status >= 500) return "provider_error";
    if (status === 408 || status === 409 || status === 425 || status === 499 || status === 504) return "provider_timeout";
    if (status === 402) return "provider_payment";
    if (status === 401) return "provider_auth";
    if (status === 403) return has(QUOTA_MARKERS) ? "rate_limited" : "provider_auth";
    if (status === 404) return "model_unavailable";
    if (status === 413) return "context_length_exceeded";
    if (status === 400 || status === 422) {
      if (has(MODEL_MARKERS)) return "model_unavailable";
      if (has(CONTEXT_MARKERS)) return "context_length_exceeded";
      if (has(POLICY_MARKERS)) return "content_filtered";
      if (has(QUOTA_MARKERS)) return "rate_limited";
      return "invalid_request";
    }
    if (has(MODEL_MARKERS)) return "model_unavailable";
    return "invalid_request";
  })();
  return { code, retryable: RETRYABLE_CODES.has(code) };
}

export function isAbortError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError";
}

/** Network-level failures (DNS, reset, TLS, timeouts) are always worth a retry. */
export function classifyNetworkError(error: unknown): { code: FailureCode; detail: string } {
  const err = error as { name?: string; message?: string } | null;
  const name = err?.name ?? "";
  const message = err?.message ?? String(error ?? "");
  const text = `${name} ${message}`.toLowerCase();
  if (name === "TimeoutError" || text.includes("timed out") || text.includes("timeout")) {
    return { code: "provider_timeout", detail: message || "request timed out" };
  }
  return { code: "network_error", detail: message || "network failure" };
}

/** Map an in-stream provider error payload onto a failure code. */
export function classifyStreamError(payload: unknown): { code: FailureCode; detail: string } {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const inner = (record.error && typeof record.error === "object" ? record.error : record) as Record<string, unknown>;
  const message = String(inner.message ?? record.message ?? (typeof record.error === "string" ? record.error : "") ?? "");
  const type = String(inner.type ?? inner.code ?? inner.status ?? "");
  const statusHint = Number(inner.status_code ?? inner.status ?? NaN);
  const text = `${type} ${message}`.toLowerCase();
  const has = (markers: string[]) => markers.some(m => text.includes(m));
  let code: FailureCode = "provider_error";
  if (Number.isFinite(statusHint) && statusHint >= 400) code = classifyHttpFailure(statusHint, text).code;
  else if (has(QUOTA_MARKERS)) code = "rate_limited";
  else if (has(CONTEXT_MARKERS)) code = "context_length_exceeded";
  else if (has(POLICY_MARKERS)) code = "content_filtered";
  else if (has(MODEL_MARKERS)) code = "model_unavailable";
  else if (text.includes("timeout") || text.includes("timed out")) code = "provider_timeout";
  return { code, detail: `${type} ${message}`.trim() || "upstream stream error" };
}

// ── SSE parsing ─────────────────────────────────────────────────────────────

export interface SSEAdapter {
  provider: ProviderId;
  /** When true, the stream must be explicitly terminated ([DONE] / finished()). */
  requiresTerminal: boolean;
  /** Text delta carried by a frame, if any. */
  delta(data: Record<string, unknown>): string | null;
  /** Frame that signals a clean end of the response. */
  finished?(data: Record<string, unknown>, event?: string): boolean;
  /** Provider-specific in-band error (beyond a generic `error` field). */
  error?(data: Record<string, unknown>, event?: string): { code: FailureCode; detail: string } | null;
}

export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return { frames: parts.filter(f => f.trim().length > 0), rest };
}

export function decodeFrame(frame: string): { event?: string; data: string } {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}

const OPENAI_STYLE: Omit<SSEAdapter, "provider"> = {
  requiresTerminal: true,
  delta(data) {
    const choices = data.choices as Array<{ delta?: { content?: unknown } }> | undefined;
    const content = choices?.[0]?.delta?.content;
    return typeof content === "string" && content ? content : null;
  },
  finished(data) {
    const choices = data.choices as Array<{ finish_reason?: unknown }> | undefined;
    const reason = choices?.[0]?.finish_reason;
    return typeof reason === "string" && reason.length > 0;
  },
};

export function adapterFor(provider: ProviderId): SSEAdapter {
  if (provider === "anthropic") {
    return {
      provider,
      requiresTerminal: true,
      delta(data) {
        const delta = data.delta as { text?: unknown } | undefined;
        return data.type === "content_block_delta" && typeof delta?.text === "string" ? delta.text : null;
      },
      finished(data, event) {
        return event === "message_stop" || data.type === "message_stop";
      },
      error(data, event) {
        if (event !== "error" && data.type !== "error") return null;
        return classifyStreamError(data);
      },
    };
  }
  if (provider === "google") {
    return {
      provider,
      // Google's `streamGenerateContent` simply closes the connection; there is
      // no [DONE] sentinel, so the end of the body is a normal completion.
      requiresTerminal: false,
      delta(data) {
        const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: unknown }> } }> | undefined;
        const parts = candidates?.[0]?.content?.parts ?? [];
        const text = parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("");
        return text || null;
      },
      finished(data) {
        const candidates = data.candidates as Array<{ finishReason?: unknown }> | undefined;
        const reason = candidates?.[0]?.finishReason;
        return typeof reason === "string" && ["STOP", "MAX_TOKENS"].includes(reason);
      },
      error(data) {
        const candidates = data.candidates as Array<{ finishReason?: unknown }> | undefined;
        const reason = candidates?.[0]?.finishReason;
        if (typeof reason === "string" && ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(reason)) {
          return { code: "content_filtered", detail: `finishReason=${reason}` };
        }
        const feedback = data.promptFeedback as { blockReason?: unknown } | undefined;
        if (typeof feedback?.blockReason === "string") return { code: "content_filtered", detail: `blockReason=${feedback.blockReason}` };
        return null;
      },
    };
  }
  return { provider, ...OPENAI_STYLE };
}

// ── Stream guards ───────────────────────────────────────────────────────────

export interface StreamGuards {
  /** Time allowed to receive response headers from the provider. */
  connectTimeoutMs: number;
  /** Time allowed between two chunks once streaming has started. */
  idleTimeoutMs: number;
  /** Hard cap on a single response. */
  maxDurationMs: number;
}

export const DEFAULT_GUARDS: StreamGuards = { connectTimeoutMs: 30_000, idleTimeoutMs: 60_000, maxDurationMs: 600_000 };

class IdleTimeout extends Error {
  constructor(public readonly ms: number) { super(`no data received for ${ms}ms`); this.name = "IdleTimeout"; }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new IdleTimeout(ms)), ms); });
  return Promise.race([promise, guard]).finally(() => { if (timer !== undefined) clearTimeout(timer); }) as Promise<T>;
}

/**
 * Normalise a provider SSE body into `StreamEvent`s.
 *
 * Emits at most one terminal event: `done` for a clean end, or `error` for an
 * upstream error frame, an idle/duration timeout, a transport failure or a
 * stream that ended without its terminator (`stream_incomplete`).
 */
export async function* readProviderEvents(
  body: ReadableStream<Uint8Array>,
  adapter: SSEAdapter,
  guards: StreamGuards = DEFAULT_GUARDS,
  now: () => number = Date.now,
): AsyncGenerator<StreamEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const startedAt = now();
  let buffer = "";
  let sawContent = false;
  let closed = false;

  try {
    while (true) {
      const elapsed = now() - startedAt;
      if (elapsed >= guards.maxDurationMs) {
        yield { type: "error", code: sawContent ? "stream_incomplete" : "provider_timeout", status: 504, detail: `maximum stream duration (${guards.maxDurationMs}ms) exceeded` };
        return;
      }
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await withTimeout(reader.read(), Math.min(guards.idleTimeoutMs, guards.maxDurationMs - elapsed));
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof IdleTimeout) {
          yield { type: "error", code: sawContent ? "stream_incomplete" : "provider_timeout", status: 504, detail: error.message };
          return;
        }
        const { code, detail } = classifyNetworkError(error);
        yield { type: "error", code: sawContent ? "stream_incomplete" : code, status: 502, detail };
        return;
      }

      if (chunk.done) { closed = true; break; }
      buffer += decoder.decode(chunk.value, { stream: true });
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const result = handleFrame(frame, adapter);
        if (!result) continue;
        if (result.type === "delta") sawContent = true;
        yield result;
        if (result.type !== "delta") return;
      }
    }

    // Flush a trailing frame that was not followed by a blank line.
    if (closed && buffer.trim()) {
      const result = handleFrame(buffer, adapter);
      if (result) {
        if (result.type === "delta") sawContent = true;
        yield result;
        if (result.type !== "delta") return;
      }
    }

    if (adapter.requiresTerminal) {
      yield { type: "error", code: sawContent ? "stream_incomplete" : "empty_response", status: 502, detail: "provider stream ended without a terminator" };
      return;
    }
    if (!sawContent) {
      yield { type: "error", code: "empty_response", status: 502, detail: "provider stream produced no content" };
      return;
    }
    yield { type: "done" };
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

function handleFrame(frame: string, adapter: SSEAdapter): StreamEvent | null {
  const { event, data } = decodeFrame(frame);
  if (!data) return null;
  if (data.trim() === "[DONE]") return { type: "done" };
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(data);
    if (!value || typeof value !== "object") return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null; // keep-alives / partial frames are not fatal
  }
  const custom = adapter.error?.(parsed, event);
  if (custom) return { type: "error", code: custom.code, status: statusForCode(custom.code), detail: custom.detail };
  if (event === "error" || (parsed.error !== undefined && parsed.error !== null)) {
    const { code, detail } = classifyStreamError(parsed);
    return { type: "error", code, status: statusForCode(code), detail };
  }
  const text = adapter.delta(parsed);
  if (text) return { type: "delta", text };
  if (adapter.finished?.(parsed, event)) return { type: "done" };
  return null;
}

// ── Provider requests ───────────────────────────────────────────────────────

export interface ProviderRequest {
  url: string;
  init: RequestInit;
  adapter: SSEAdapter;
}

/** Attach images to the last user turn using each provider's own shape. */
export function providerMessages(messages: Message[], provider: ProviderId, images: Image[]): Message[] {
  if (!images.length) return messages;
  const lastUser = messages.map(m => m.role).lastIndexOf("user");
  return messages.map((m, i) => {
    if (i !== lastUser || typeof m.content !== "string") return m;
    if (provider === "openai") return { ...m, content: [{ type: "text", text: m.content }, ...images.map(x => ({ type: "image_url", image_url: { url: `data:${x.mime_type};base64,${x.base64}` } }))] };
    if (provider === "anthropic") return { ...m, content: [...images.map(x => ({ type: "image", source: { type: "base64", media_type: x.mime_type, data: x.base64 } })), { type: "text", text: m.content }] };
    if (provider === "google") return { ...m, content: [{ text: m.content }, ...images.map(x => ({ inlineData: { mimeType: x.mime_type, data: x.base64 } }))] };
    return m;
  });
}

const MAX_OUTPUT_TOKENS = 4096;

/**
 * Build the upstream HTTP request for a model.
 *
 * Credentials are always sent in headers — notably Google, which also accepts
 * `?key=`; query strings leak into proxy logs and error messages, so we use
 * `x-goog-api-key` instead.
 */
export function buildProviderRequest(model: ModelSpec, messages: Message[], apiKey: string): ProviderRequest {
  const providerModel = model.provider_model ?? model.id;
  const adapter = adapterFor(model.provider);
  const jsonHeaders = { "Content-Type": "application/json" };

  if (model.provider === "anthropic") {
    const system = messages.filter(m => m.role === "system").map(m => String(m.content)).join("\n") || "You are a helpful AI assistant.";
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: { ...jsonHeaders, "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: providerModel, system, messages: messages.filter(m => m.role !== "system"), max_tokens: MAX_OUTPUT_TOKENS, stream: true }),
      },
      adapter,
    };
  }

  if (model.provider === "google") {
    const system = messages.filter(m => m.role === "system").map(m => String(m.content)).join("\n");
    const contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: Array.isArray(m.content) ? m.content : [{ text: m.content }],
    }));
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${providerModel}:streamGenerateContent?alt=sse`,
      init: {
        method: "POST",
        headers: { ...jsonHeaders, "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS } }),
      },
      adapter,
    };
  }

  const endpoints: Record<"openai" | "groq" | "deepseek", string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
  };
  return {
    url: endpoints[model.provider],
    init: {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: providerModel, messages, stream: true, max_tokens: MAX_OUTPUT_TOKENS }),
    },
    adapter,
  };
}

// ── Calling a single model ──────────────────────────────────────────────────

export interface CallOptions {
  fetchImpl?: FetchLike;
  env?: EnvReader;
  guards?: Partial<StreamGuards>;
  /** Aborted when the browser disconnects. */
  signal?: AbortSignal;
  now?: () => number;
}

export interface ModelStream {
  model: ModelSpec;
  events: AsyncGenerator<StreamEvent, void, unknown>;
}

async function fetchWithConnectTimeout(url: string, init: RequestInit, timeoutMs: number, fetchImpl: FetchLike, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort((signal as { reason?: unknown } | undefined)?.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException("Provider connect timeout", "TimeoutError")), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Open a stream for one model. Resolves only once the first content delta is
 * in hand, so a provider that fails at connect time *or* immediately inside
 * the stream (in-band error / empty body) can still be replaced by the next
 * candidate before a single byte is sent to the browser.
 */
export async function openModelStream(model: ModelSpec, messages: Message[], images: Image[], options: CallOptions = {}): Promise<ModelStream> {
  const env = options.env ?? denoEnv;
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const guards: StreamGuards = { ...DEFAULT_GUARDS, ...options.guards };
  const apiKey = apiKeyFor(model.provider, env);

  if (images.length && !model.supports_vision) {
    throw new ProviderError({ provider: model.provider, code: "images_unsupported", detail: `${model.id} has no vision support`, retryable: false });
  }
  if (!apiKey) {
    throw new ProviderError({ provider: model.provider, code: "provider_not_configured", detail: `${API_KEY_ENV[model.provider]} is not set` });
  }

  const payload = providerMessages(messages, model.provider, images);
  const { url, init, adapter } = buildProviderRequest(model, payload, apiKey);

  let response: Response;
  try {
    response = await fetchWithConnectTimeout(url, init, guards.connectTimeoutMs, fetchImpl, options.signal);
  } catch (error) {
    if (isAbortError(error) && options.signal?.aborted) throw error;
    const { code, detail } = classifyNetworkError(error);
    throw new ProviderError({ provider: model.provider, code, detail: redactSecrets(detail, [apiKey]) });
  }

  if (!response.ok) {
    let body = "";
    try { body = await response.text(); } catch { /* body already consumed / unreadable */ }
    const { code, retryable } = classifyHttpFailure(response.status, body);
    throw new ProviderError({
      provider: model.provider,
      code,
      retryable,
      // Kept for server-side logs only, truncated and redacted.
      detail: redactSecrets(`HTTP ${response.status} ${body.slice(0, 500)}`, [apiKey]),
    });
  }
  if (!response.body) {
    throw new ProviderError({ provider: model.provider, code: "empty_response", detail: "provider returned no response body" });
  }

  const events = readProviderEvents(response.body, adapter, guards, options.now);

  // Peek until the first delta so pre-flight failures are still recoverable.
  const buffered: StreamEvent[] = [];
  let opened = false;
  try {
    while (true) {
      const next = await events.next();
      if (next.done) {
        throw new ProviderError({ provider: model.provider, code: "empty_response", detail: "provider stream closed before any content" });
      }
      const event = next.value;
      if (event.type === "delta") { buffered.push(event); opened = true; break; }
      if (event.type === "done") {
        throw new ProviderError({ provider: model.provider, code: "empty_response", detail: "provider completed without content" });
      }
      // Error before any content: safe to fall back to the next provider.
      throw new ProviderError({
        provider: model.provider,
        code: event.code === "stream_incomplete" ? "provider_error" : event.code,
        detail: redactSecrets(event.detail, [apiKey]),
      });
    }
  } finally {
    // Never leave the upstream body dangling when we bail out.
    if (!opened) await events.return(undefined).catch(() => {});
  }

  async function* replay(): AsyncGenerator<StreamEvent, void, unknown> {
    try {
      for (const event of buffered) yield event;
      for await (const event of events) yield event;
    } finally {
      await events.return(undefined);
    }
  }

  return { model, events: replay() };
}

// ── Fallback across providers ───────────────────────────────────────────────

export interface Attempt {
  model: string;
  provider: string;
  code: FailureCode;
  status: number;
  retryable: boolean;
  detail: string;
}

export interface FallbackOptions extends CallOptions {
  onAttempt?: (attempt: Attempt) => void;
}

/**
 * Walk the candidate chain until one model streams content.
 *
 * Transient / model-specific failures move on to the next candidate; failures
 * caused by the request itself (invalid input, context overflow, content
 * policy) stop immediately — retrying them everywhere only burns time and
 * quota. When every candidate fails the caller gets a single
 * `providers_unavailable` error carrying the redacted attempt log.
 */
export async function streamWithFallback(candidates: ModelSpec[], messages: Message[], images: Image[], options: FallbackOptions = {}): Promise<{ stream: ModelStream; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const deadProviders = new Set<string>();

  for (const candidate of candidates) {
    if (deadProviders.has(candidate.provider)) continue;
    try {
      const stream = await openModelStream(candidate, messages, images, options);
      return { stream, attempts };
    } catch (error) {
      if (isAbortError(error)) throw error;
      const providerError = error instanceof ProviderError
        ? error
        : new ProviderError({ provider: candidate.provider, ...classifyNetworkError(error) });
      const attempt: Attempt = {
        model: candidate.id,
        provider: candidate.provider,
        code: providerError.code,
        status: providerError.status,
        retryable: providerError.retryable,
        detail: providerError.detail,
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      if (!providerError.retryable) throw providerError;
      // A missing/rejected key kills every model from that provider.
      if (providerError.code === "provider_not_configured" || providerError.code === "provider_auth" || providerError.code === "provider_payment") {
        deadProviders.add(candidate.provider);
      }
    }
  }

  throw new ProviderError({
    provider: "all",
    code: "providers_unavailable",
    status: 502,
    retryable: false,
    detail: attempts.map(a => `${a.model}(${a.provider}) ${a.code} ${a.status}`).join("; ") || "no candidate models",
  });
}

// ── Wire format sent to the browser ─────────────────────────────────────────

export function sseDelta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

export function sseError(code: FailureCode, requestId: string): string {
  const payload = { error: userMessage(code), code, request_id: requestId };
  return `event: error\ndata: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

/**
 * Turn normalised events into the SSE body the browser consumes.
 * `[DONE]` is only ever written for a clean completion, so the client can
 * detect an interrupted answer and keep the partial text it already has.
 */
export function toSSEBody(
  events: AsyncGenerator<StreamEvent, void, unknown>,
  requestId: string,
  onFinish?: (outcome: { code: FailureCode | null; chars: number }) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let chars = 0;
  let finished: FailureCode | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          // Generator ended without a terminal event — treat as interrupted.
          if (!finished) { finished = "stream_incomplete"; controller.enqueue(encoder.encode(sseError("stream_incomplete", requestId))); }
          onFinish?.({ code: finished === "stream_incomplete" && chars === 0 ? "empty_response" : finished, chars });
          controller.close();
          return;
        }
        const event = next.value;
        if (event.type === "delta") {
          chars += event.text.length;
          controller.enqueue(encoder.encode(sseDelta(event.text)));
          return;
        }
        if (event.type === "done") {
          finished = null;
          controller.enqueue(encoder.encode(SSE_DONE));
          onFinish?.({ code: null, chars });
          controller.close();
          return;
        }
        finished = event.code;
        controller.enqueue(encoder.encode(sseError(event.code, requestId)));
        onFinish?.({ code: event.code, chars });
        controller.close();
      } catch (error) {
        if (isAbortError(error)) { controller.close(); return; }
        const { code } = classifyNetworkError(error);
        controller.enqueue(encoder.encode(sseError(chars > 0 ? "stream_incomplete" : code, requestId)));
        onFinish?.({ code: chars > 0 ? "stream_incomplete" : code, chars });
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
}
