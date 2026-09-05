/**
 * Offline tests for the chat provider layer.
 *
 * Everything here runs without network or env access: `fetch` is injected and
 * API keys are passed through a fake env reader. Run with:
 *   deno test supabase/functions/chat/providers_test.ts
 */
import {
  adapterFor,
  apiKeyFor,
  buildProviderRequest,
  classifyHttpFailure,
  classifyNetworkError,
  classifyStreamError,
  DEFAULT_GUARDS,
  fallbackChain,
  isAliasedModel,
  MODEL_ALIASES,
  MODELS,
  openModelStream,
  ProviderError,
  publicModels,
  readProviderEvents,
  redactSecrets,
  resolveModel,
  statusForCode,
  streamWithFallback,
  toSSEBody,
  userMessage,
  type Attempt,
  type EnvReader,
  type FetchLike,
  type ModelSpec,
  type StreamEvent,
} from "./providers.ts";

// ── assertions (hand-rolled: the suite has zero dependencies) ──────────────

class AssertionError extends Error {
  constructor(message: string) { super(message); this.name = "AssertionError"; }
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => key in right && deepEqual(left[key], right[key]));
}

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message ?? "expected a truthy value");
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  }
}
function assertMatch(actual: string, expected: RegExp, message?: string): void {
  if (!expected.test(actual)) throw new AssertionError(message ?? `expected ${show(actual)} to match ${expected}`);
}
function assertNotMatch(actual: string, expected: RegExp, message?: string): void {
  if (expected.test(actual)) throw new AssertionError(message ?? `expected ${show(actual)} not to match ${expected}`);
}
function assertStringIncludes(actual: string, expected: string, message?: string): void {
  if (!actual.includes(expected)) throw new AssertionError(message ?? `expected ${show(actual)} to include ${show(expected)}`);
}
async function assertRejects<T extends Error>(fn: () => Promise<unknown>, ctor: new (...args: never[]) => T, message?: string): Promise<T> {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof ctor)) throw new AssertionError(message ?? `expected ${ctor.name}, got ${String(error)}`);
    return error;
  }
  throw new AssertionError(message ?? `expected ${ctor.name} to be thrown`);
}

// ── helpers ────────────────────────────────────────────────────────────────

const KEYS: Record<string, string> = {
  OPENAI_API_KEY: "sk-openai-test-key-000000",
  ANTHROPIC_API_KEY: "sk-ant-test-key-000000",
  GOOGLE_API_KEY: "AIzaTESTGOOGLEKEY000000",
  GROQ_API_KEY: "gsk_testgroqkey000000",
  DEEPSEEK_API_KEY: "sk-deepseek-test-key-000",
};
const env: EnvReader = (name) => KEYS[name];
const noKeys: EnvReader = () => undefined;

const guards = { connectTimeoutMs: 50, idleTimeoutMs: 50, maxDurationMs: 500 };

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" }, ...init });
}

function textDelta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** A successful stream in whichever dialect the target provider speaks. */
function okFor(url: string, text = "ok"): Response {
  if (url.includes("generativelanguage")) {
    return sseResponse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] })}\n\n`]);
  }
  if (url.includes("api.anthropic.com")) {
    return sseResponse([
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ]);
  }
  return sseResponse([textDelta(text), "data: [DONE]\n\n"]);
}

const model = (id: string): ModelSpec => {
  const found = resolveModel(id);
  if (!found) throw new Error(`unknown test model ${id}`);
  return found;
};

/** Scripted fetch: one handler per call, in order. Records the requests. */
function scriptedFetch(handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    return await handler(url, init);
  };
  return { fetchImpl, calls };
}

async function drain(events: AsyncGenerator<StreamEvent, void, unknown>) {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

// ── model catalog ──────────────────────────────────────────────────────────

Deno.test("catalog: retired Groq model ids are gone", () => {
  const ids = MODELS.map(m => m.id);
  const providerIds = MODELS.map(m => m.provider_model ?? m.id);
  for (const retired of ["llama-3.3-70b", "llama-3.1-8b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]) {
    assert(!ids.includes(retired), `${retired} must not be offered`);
    assert(!providerIds.includes(retired), `${retired} must not be sent to a provider`);
  }
});

Deno.test("catalog: retired ids still resolve through aliases (saved preferences keep working)", () => {
  assertEquals(resolveModel("llama-3.3-70b")?.id, "gpt-oss-120b");
  assertEquals(resolveModel("llama-3.3-70b-versatile")?.id, "gpt-oss-120b");
  assertEquals(resolveModel("llama-3.1-8b")?.id, "gpt-oss-20b");
  assertEquals(resolveModel("llama-3.1-8b-instant")?.id, "gpt-oss-20b");
  assert(isAliasedModel("llama-3.3-70b"));
  assert(!isAliasedModel("gpt-oss-120b"));
  assertEquals(resolveModel("totally-made-up"), null);
  // Every alias target must exist in the catalog.
  for (const target of Object.values(MODEL_ALIASES)) {
    assert(MODELS.some(m => m.id === target), `alias target ${target} missing from catalog`);
  }
});

Deno.test("catalog: public payload hides provider-side ids", () => {
  const models = publicModels();
  assertEquals(models.length, MODELS.length);
  assert(models.every(m => !("provider_model" in m)));
});

Deno.test("fallback chain: unique, vision-safe and primary-first", () => {
  const chain = fallbackChain(model("gpt-oss-120b"), false).map(m => m.id);
  assertEquals(chain[0], "gpt-oss-120b");
  assertEquals(new Set(chain).size, chain.length);
  const vision = fallbackChain(model("gpt-4o"), true);
  assertEquals(vision[0].id, "gpt-4o");
  assert(vision.every(m => m.supports_vision));
});

// ── failure classification ─────────────────────────────────────────────────

Deno.test("classification: retryable vs permanent failures", () => {
  // Retryable — try the next provider.
  assertEquals(classifyHttpFailure(400, `{"error":{"message":"The model \`llama-3.3-70b-versatile\` has been decommissioned"}}`), { code: "model_unavailable", retryable: true });
  assertEquals(classifyHttpFailure(404, `{"error":{"code":"model_not_found"}}`), { code: "model_unavailable", retryable: true });
  assertEquals(classifyHttpFailure(401, "invalid api key").retryable, true);
  assertEquals(classifyHttpFailure(403, "forbidden").code, "provider_auth");
  assertEquals(classifyHttpFailure(402, "payment required").code, "provider_payment");
  assertEquals(classifyHttpFailure(408, "timeout").code, "provider_timeout");
  assertEquals(classifyHttpFailure(429, "rate limit reached"), { code: "rate_limited", retryable: true });
  assertEquals(classifyHttpFailure(500, "internal"), { code: "provider_error", retryable: true });
  assertEquals(classifyHttpFailure(503, "overloaded"), { code: "provider_error", retryable: true });

  // Permanent — do not burn the whole chain on them.
  assertEquals(classifyHttpFailure(400, `{"error":{"message":"messages[0] is malformed"}}`), { code: "invalid_request", retryable: false });
  assertEquals(classifyHttpFailure(400, `{"error":{"code":"context_length_exceeded"}}`), { code: "context_length_exceeded", retryable: false });
  assertEquals(classifyHttpFailure(400, `{"error":{"message":"blocked by content policy"}}`), { code: "content_filtered", retryable: false });
  assertEquals(classifyHttpFailure(413, "payload too large"), { code: "context_length_exceeded", retryable: false });
});

Deno.test("classification: network and in-stream errors", () => {
  assertEquals(classifyNetworkError(new TypeError("error sending request: connection reset by peer")).code, "network_error");
  assertEquals(classifyNetworkError(Object.assign(new Error("timed out"), { name: "TimeoutError" })).code, "provider_timeout");
  assertEquals(classifyStreamError({ error: { type: "rate_limit_error", message: "slow down" } }).code, "rate_limited");
  assertEquals(classifyStreamError({ error: { type: "overloaded_error", message: "overloaded" } }).code, "provider_error");
  assertEquals(classifyStreamError({ error: { message: "blocked by content policy" } }).code, "content_filtered");
  assertEquals(statusForCode("providers_unavailable"), 502);
  assertEquals(statusForCode("context_length_exceeded"), 413);
  assertEquals(statusForCode("rate_limited"), 429);
});

// ── credentials ────────────────────────────────────────────────────────────

Deno.test("google: the API key travels in a header, never in the URL", () => {
  const request = buildProviderRequest(model("gemini-3.7-flash"), [{ role: "user", content: "hi" }], KEYS.GOOGLE_API_KEY);
  assertNotMatch(request.url, /key=/);
  assert(!request.url.includes(KEYS.GOOGLE_API_KEY));
  assertEquals((request.init.headers as Record<string, string>)["x-goog-api-key"], KEYS.GOOGLE_API_KEY);
  assertStringIncludes(request.url, "alt=sse");
  // Preview id is applied provider-side only.
  const pro = buildProviderRequest(model("gemini-3.1-pro"), [{ role: "user", content: "hi" }], "k");
  assertStringIncludes(pro.url, "gemini-3.1-pro-preview:streamGenerateContent");
});

Deno.test("redaction: keys never survive into log lines", () => {
  const leak = `Bearer ${KEYS.OPENAI_API_KEY} groq=${KEYS.GROQ_API_KEY} google key=${KEYS.GOOGLE_API_KEY}`;
  const safe = redactSecrets(leak, Object.values(KEYS));
  for (const key of Object.values(KEYS)) assert(!safe.includes(key), `leaked ${key}`);
  // Unknown-shaped keys are caught by the pattern rules too.
  assertNotMatch(redactSecrets("authorization: sk-abcdefghijklmnop"), /sk-abcdefghijklmnop/);
});

Deno.test("credentials: a missing key is a provider failure, not a crash", async () => {
  const { fetchImpl, calls } = scriptedFetch([() => sseResponse([textDelta("x"), "data: [DONE]\n\n"])]);
  assertEquals(apiKeyFor("openai", noKeys), "");
  const error = await assertRejects(
    () => openModelStream(model("gpt-4o"), [{ role: "user", content: "hi" }], [], { env: noKeys, fetchImpl, guards }),
    ProviderError,
  );
  assertEquals(error.code, "provider_not_configured");
  assertEquals(error.retryable, true);
  assertEquals(calls.length, 0);
});

// ── fallback behaviour ─────────────────────────────────────────────────────

async function fallbackFor(handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const { fetchImpl, calls } = scriptedFetch(handlers);
  const attempts: Attempt[] = [];
  const result = await streamWithFallback(
    fallbackChain(model("gpt-oss-120b"), false),
    [{ role: "user", content: "hi" }],
    [],
    { env, fetchImpl, guards, onAttempt: a => attempts.push(a) },
  );
  const events = await drain(result.stream.events);
  return { calls, attempts, model: result.stream.model, events };
}

Deno.test("fallback: a retired model 400 moves on to the next provider", async () => {
  const { attempts, model: used, events } = await fallbackFor([
    () => new Response(`{"error":{"message":"model \`llama-3.3-70b-versatile\` has been decommissioned"}}`, { status: 400 }),
    (url: string) => okFor(url),
  ]);
  assertEquals(attempts.map(a => a.code), ["model_unavailable"]);
  assertEquals(used.id, "gemini-3.7-flash");
  assertEquals(events.filter(e => e.type === "delta").length, 1);
});

Deno.test("fallback: 404 model not found", async () => {
  const { attempts, model: used } = await fallbackFor([
    () => new Response(`{"error":{"code":"model_not_found"}}`, { status: 404 }),
    (url: string) => okFor(url),
  ]);
  assertEquals(attempts[0].code, "model_unavailable");
  assertEquals(used.provider, "google");
});

Deno.test("fallback: 429 rate limit", async () => {
  const { attempts, model: used } = await fallbackFor([
    () => new Response(`{"error":{"message":"rate limit reached"}}`, { status: 429 }),
    (url: string) => okFor(url),
  ]);
  assertEquals(attempts[0].code, "rate_limited");
  assertEquals(used.id, "gemini-3.7-flash");
});

Deno.test("fallback: 5xx upstream failure", async () => {
  const { attempts, model: used } = await fallbackFor([
    () => new Response("upstream exploded", { status: 503 }),
    (url: string) => okFor(url),
  ]);
  assertEquals(attempts[0].code, "provider_error");
  assertEquals(used.id, "gemini-3.7-flash");
});

Deno.test("fallback: network failure / connection reset", async () => {
  const { attempts, model: used } = await fallbackFor([
    () => Promise.reject(new TypeError("error sending request: connection reset by peer")),
    (url: string) => okFor(url),
  ]);
  assertEquals(attempts[0].code, "network_error");
  assertEquals(used.id, "gemini-3.7-flash");
});

Deno.test("fallback: an in-stream error before any content still falls back", async () => {
  const { attempts, model: used, events } = await fallbackFor([
    () => sseResponse([`data: ${JSON.stringify({ error: { type: "server_error", message: "boom" } })}\n\n`]),
    (url: string) => okFor(url, "recovered"),
  ]);
  assertEquals(attempts[0].code, "provider_error");
  assertEquals(used.id, "gemini-3.7-flash");
  assertEquals(events[0], { type: "delta", text: "recovered" });
});

Deno.test("fallback: permanent request failures stop the chain immediately", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    () => new Response(`{"error":{"code":"context_length_exceeded","message":"too many tokens"}}`, { status: 400 }),
  ]);
  const error = await assertRejects(
    () => streamWithFallback(fallbackChain(model("gpt-oss-120b"), false), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards }),
    ProviderError,
  );
  assertEquals(error.code, "context_length_exceeded");
  assertEquals(error.retryable, false);
  assertEquals(calls.length, 1);
});

Deno.test("fallback: when every provider fails the caller gets one clean 502", async () => {
  const { fetchImpl, calls } = scriptedFetch([() => new Response("upstream exploded: key sk-should-not-leak", { status: 500 })]);
  const attempts: Attempt[] = [];
  const error = await assertRejects(
    () => streamWithFallback(fallbackChain(model("gpt-oss-120b"), false), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards, onAttempt: a => attempts.push(a) }),
    ProviderError,
  );
  assertEquals(error.code, "providers_unavailable");
  assertEquals(statusForCode(error.code), 502);
  assert(calls.length >= 3, "every candidate should have been tried");
  assertEquals(attempts.length, calls.length);
  assertEquals(userMessage("providers_unavailable"), "AI provider is temporarily unavailable. Please try again.");
});

Deno.test("fallback: one dead provider does not consume the whole chain", async () => {
  // 401 kills the provider; the next candidate must be a *different* provider.
  const { fetchImpl, calls } = scriptedFetch([
    () => new Response(`{"error":{"message":"invalid api key"}}`, { status: 401 }),
    (url: string) => okFor(url),
  ]);
  const result = await streamWithFallback(fallbackChain(model("gpt-oss-20b"), false), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards });
  await drain(result.stream.events);
  assertEquals(result.stream.model.provider, "google");
  assertEquals(calls.length, 2, "the second groq model must be skipped after a 401");
});

// ── leak protection ────────────────────────────────────────────────────────

Deno.test("leaks: upstream error bodies never reach the browser", async () => {
  const upstreamBody = `{"error":{"message":"internal trace id=abc secret prompt text","api_key":"${KEYS.GROQ_API_KEY}"}}`;
  const { fetchImpl } = scriptedFetch([() => new Response(upstreamBody, { status: 500 })]);
  const error = await assertRejects(
    () => streamWithFallback(fallbackChain(model("gpt-oss-120b"), false), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards }),
    ProviderError,
  );
  const clientPayload = JSON.stringify({ error: userMessage(error.code), code: error.code, request_id: "req-1" });
  assert(!clientPayload.includes("internal trace"), "upstream body leaked to the client");
  assert(!clientPayload.includes(KEYS.GROQ_API_KEY), "api key leaked to the client");
  assert(!error.message.includes("internal trace"), "upstream body leaked into the error message");
});

Deno.test("leaks: API keys stay out of URLs, error details and log fields", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    () => new Response(`unauthorized: key ${KEYS.GOOGLE_API_KEY}`, { status: 500 }),
    (url: string) => okFor(url),
  ]);
  const attempts: Attempt[] = [];
  const result = await streamWithFallback(
    fallbackChain(model("gemini-3.7-flash"), false),
    [{ role: "user", content: "hi" }],
    [],
    { env, fetchImpl, guards, onAttempt: a => attempts.push(a) },
  );
  await drain(result.stream.events);
  for (const call of calls) assert(!call.url.includes("key="), `key in URL: ${call.url}`);
  for (const key of Object.values(KEYS)) {
    for (const call of calls) assert(!call.url.includes(key), "key in URL");
    for (const attempt of attempts) assert(!attempt.detail.includes(key), `key in attempt detail: ${attempt.detail}`);
  }
  assertStringIncludes(attempts[0].detail, "[redacted]");
});

// ── stream normalisation ───────────────────────────────────────────────────

Deno.test("stream: a mid-stream provider error becomes a structured SSE error", async () => {
  const { fetchImpl } = scriptedFetch([
    () => sseResponse([
      textDelta("partial answer"),
      `data: ${JSON.stringify({ error: { type: "rate_limit_error", message: "quota exhausted" } })}\n\n`,
    ]),
  ]);
  const result = await openModelStream(model("gpt-oss-120b"), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards });
  const body = await readAll(toSSEBody(result.events, "req-9"));
  assertStringIncludes(body, '"content":"partial answer"');
  assertStringIncludes(body, "event: error");
  assertStringIncludes(body, '"code":"rate_limited"');
  assertStringIncludes(body, '"request_id":"req-9"');
  assert(!body.includes("quota exhausted"), "upstream detail leaked into the SSE error");
  assert(!body.includes("[DONE]"), "a failed stream must not be marked complete");
});

Deno.test("stream: ending without [DONE] surfaces stream_incomplete and keeps the text", async () => {
  const { fetchImpl } = scriptedFetch([() => sseResponse([textDelta("half an "), textDelta("answer")])]);
  const result = await openModelStream(model("gpt-oss-120b"), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards });
  const body = await readAll(toSSEBody(result.events, "req-10"));
  assertStringIncludes(body, '"content":"half an "');
  assertStringIncludes(body, '"content":"answer"');
  assertStringIncludes(body, '"code":"stream_incomplete"');
  assert(!body.includes("[DONE]"));
});

Deno.test("stream: a partial response is preserved when the transport dies mid-stream", async () => {
  const encoder = new TextEncoder();
  let sent = false;
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      // Deliver the first half, then die like a reset connection would.
      if (!sent) { sent = true; controller.enqueue(encoder.encode(textDelta("first half"))); return; }
      controller.error(new TypeError("connection reset by peer"));
    },
  });
  const { fetchImpl } = scriptedFetch([() => new Response(broken, { status: 200, headers: { "Content-Type": "text/event-stream" } })]);
  const result = await openModelStream(model("gpt-oss-120b"), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards });
  const chunks: string[] = [];
  const body = toSSEBody(result.events, "req-11", outcome => chunks.push(`${outcome.code}:${outcome.chars}`));
  const text = await readAll(body);
  assertStringIncludes(text, '"content":"first half"');
  assertStringIncludes(text, '"code":"stream_incomplete"');
  assertEquals(chunks, ["stream_incomplete:10"]);
});

Deno.test("stream: an idle provider trips the idle timeout instead of hanging", async () => {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(textDelta("start")));
      timer = setTimeout(() => { try { controller.close(); } catch { /* already closed */ } }, 5_000);
    },
    cancel() { if (timer !== undefined) clearTimeout(timer); },
  });
  const events = readProviderEvents(stalled, adapterFor("groq"), { ...guards, idleTimeoutMs: 20 });
  const collected = await drain(events);
  if (timer !== undefined) clearTimeout(timer);
  assertEquals(collected[0], { type: "delta", text: "start" });
  assertEquals(collected[1].type, "error");
  assertEquals((collected[1] as { code: string }).code, "stream_incomplete");
});

Deno.test("stream: an empty provider response is reported as empty_response", async () => {
  const { fetchImpl } = scriptedFetch([() => sseResponse(["data: [DONE]\n\n"])]);
  const error = await assertRejects(
    () => openModelStream(model("gpt-oss-120b"), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards }),
    ProviderError,
  );
  assertEquals(error.code, "empty_response");
  assertEquals(userMessage("empty_response"), "The AI returned an empty response. Please try again.");

  // …and when every provider is empty the client still gets a clean envelope.
  const { fetchImpl: allEmpty } = scriptedFetch([() => sseResponse(["data: [DONE]\n\n"])]);
  const all = await assertRejects(
    () => streamWithFallback(fallbackChain(model("gpt-oss-120b"), false), [{ role: "user", content: "hi" }], [], { env, fetchImpl: allEmpty, guards }),
    ProviderError,
  );
  assertEquals(all.code, "providers_unavailable");
});

Deno.test("stream: a clean OpenAI-style stream ends with [DONE]", async () => {
  const { fetchImpl } = scriptedFetch([() => sseResponse([
    textDelta("Hello"),
    textDelta(" world"),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ])]);
  const result = await openModelStream(model("gpt-oss-120b"), [{ role: "user", content: "hi" }], [], { env, fetchImpl, guards });
  const body = await readAll(toSSEBody(result.events, "req-12"));
  assertStringIncludes(body, '"content":"Hello"');
  assertStringIncludes(body, '"content":" world"');
  assertMatch(body, /data: \[DONE\]\n\n$/);
  assert(!body.includes("event: error"));
});

Deno.test("stream: anthropic and google dialects normalise to the same events", async () => {
  const anthropic = [
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text: "A" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  assertEquals(await drain(readProviderEvents(sseResponse(anthropic).body!, adapterFor("anthropic"), guards)), [
    { type: "delta", text: "A" },
    { type: "done" },
  ]);

  const google = [
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "G" }] } }] })}\n\n`,
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "!" }] }, finishReason: "STOP" }] })}\n\n`,
  ];
  assertEquals(await drain(readProviderEvents(sseResponse(google).body!, adapterFor("google"), guards)), [
    { type: "delta", text: "G" },
    { type: "delta", text: "!" },
    { type: "done" },
  ]);

  const blocked = [`data: ${JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })}\n\n`];
  const events = await drain(readProviderEvents(sseResponse(blocked).body!, adapterFor("google"), guards));
  assertEquals((events[0] as { code: string }).code, "content_filtered");
});

Deno.test("stream: frames split across chunk boundaries are reassembled", async () => {
  const frame = textDelta("नमस्ते");
  const bytes = new TextEncoder().encode(frame);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 30));
      controller.enqueue(bytes.slice(30));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  assertEquals(await drain(readProviderEvents(stream, adapterFor("openai"), guards)), [
    { type: "delta", text: "नमस्ते" },
    { type: "done" },
  ]);
});

Deno.test("guards: defaults are sane (no single 90s cliff for long answers)", () => {
  assert(DEFAULT_GUARDS.connectTimeoutMs <= 60_000);
  assert(DEFAULT_GUARDS.idleTimeoutMs >= 30_000);
  assert(DEFAULT_GUARDS.maxDurationMs >= 300_000);
  assert(DEFAULT_GUARDS.maxDurationMs > DEFAULT_GUARDS.idleTimeoutMs);
});

Deno.test("requests: images are shaped per provider and rejected on text-only models", async () => {
  const image = { base64: "AAAA", mime_type: "image/png" };
  const error = await assertRejects(
    () => openModelStream(model("gpt-oss-120b"), [{ role: "user", content: "look" }], [image], { env, fetchImpl: scriptedFetch([() => sseResponse([])]).fetchImpl, guards }),
    ProviderError,
  );
  assertEquals(error.code, "images_unsupported");
  assertEquals(error.retryable, false);

  const { fetchImpl, calls } = scriptedFetch([() => sseResponse([textDelta("ok"), "data: [DONE]\n\n"])]);
  const result = await openModelStream(model("gpt-4o"), [{ role: "user", content: "look" }], [image], { env, fetchImpl, guards });
  await drain(result.events);
  assertStringIncludes(String(calls[0].init?.body), "image_url");
});
