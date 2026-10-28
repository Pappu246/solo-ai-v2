/**
 * Offline tests for provider health tracking and capability-aware routing.
 *
 * Deterministic (injected clock, scripted fetch, no network/env). Run with:
 *   deno test supabase/functions/chat/health_test.ts
 */
import {
  fallbackChain,
  MODELS,
  ProviderError,
  resolveModel,
  ROUTE_PREFERENCE,
  selectAutoModel,
  streamWithFallback,
  type Attempt,
  type EnvReader,
  type FetchLike,
  type ModelSpec,
  type StreamEvent,
} from "./providers.ts";
import { ProviderHealth } from "./health.ts";

// ── assertions (hand-rolled: the suite has zero dependencies) ──────────────

class AssertionError extends Error {
  constructor(message: string) { super(message); this.name = "AssertionError"; }
}
function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message ?? "expected a truthy value");
}
function show(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

const KEYS: Record<string, string> = {
  GOOGLE_API_KEY: "AIzaTESTGOOGLEKEY000000",
  GROQ_API_KEY: "gsk_testgroqkey000000",
  OPENROUTER_API_KEY: "sk-or-test-key-000000",
};
const env: EnvReader = (name) => KEYS[name];
const guards = { connectTimeoutMs: 50, idleTimeoutMs: 50, maxDurationMs: 500 };

const model = (id: string): ModelSpec => {
  const found = resolveModel(id);
  if (!found) throw new Error(`unknown test model ${id}`);
  return found;
};

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** A successful stream in whichever dialect the target provider speaks. */
function okFor(url: string, text = "ok"): Response {
  if (url.includes("generativelanguage")) {
    return sseResponse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] })}\n\n`]);
  }
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

function scriptedFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return await handler(url, init);
  };
  return { fetchImpl, calls };
}

async function drain(events: AsyncGenerator<StreamEvent, void, unknown>) {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function failingHealth(...failures: Array<[provider: string, code: string]>): { health: ProviderHealth; clock: { t: number } } {
  const clock = { t: 1_000_000 };
  const health = new ProviderHealth({ now: () => clock.t });
  for (const [provider, code] of failures) health.recordFailure(provider, { code, retryable: true });
  return { health, clock };
}

// ── health: cooldown, recovery, backoff ────────────────────────────────────

Deno.test("health: a transient failure starts a temporary cooldown that expires", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  assert(health.isHealthy("groq"));
  health.recordFailure("groq", { code: "provider_error", retryable: true });
  assert(!health.isHealthy("groq"), "provider should cool down after a failure");
  assertEquals(health.cooldownRemainingMs("groq"), 5_000);
  clock.t = 4_999;
  assert(!health.isHealthy("groq"));
  clock.t = 5_000;
  assert(health.isHealthy("groq"), "cooldown must expire — no permanent disabling");
  assertEquals(health.cooldownRemainingMs("groq"), 0);
});

Deno.test("health: repeated failures back off exponentially and are capped", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t, maxCooldownMs: 60_000 });
  health.recordFailure("openai", { code: "provider_error", retryable: true });
  assertEquals(health.cooldownRemainingMs("openai"), 5_000);
  clock.t = 5_000;
  health.recordFailure("openai", { code: "provider_error", retryable: true });
  assertEquals(health.cooldownRemainingMs("openai"), 10_000);
  clock.t = 15_000;
  health.recordFailure("openai", { code: "provider_error", retryable: true });
  assertEquals(health.cooldownRemainingMs("openai"), 20_000);
  // Keep hammering: never exceeds the cap.
  for (let i = 0; i < 10; i++) {
    clock.t += 20_000;
    health.recordFailure("openai", { code: "provider_error", retryable: true });
    assert(health.cooldownRemainingMs("openai") <= 60_000, "cooldown must be capped");
  }
});

Deno.test("health: a success clears the failure streak and any cooldown", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  health.recordFailure("groq", { code: "provider_error", retryable: true });
  health.recordFailure("groq", { code: "provider_error", retryable: true });
  assert(!health.isHealthy("groq"));
  health.recordSuccess("groq");
  assert(health.isHealthy("groq"));
  health.recordFailure("groq", { code: "provider_error", retryable: true });
  assertEquals(health.cooldownRemainingMs("groq"), 5_000, "backoff restarts after a success");
});

Deno.test("health: rate limits cool down longer than plain 5xx failures", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  health.recordFailure("google", { code: "rate_limited", retryable: true });
  assertEquals(health.cooldownRemainingMs("google"), 15_000);
  health.recordFailure("deepseek", { code: "provider_auth", retryable: true });
  assertEquals(health.cooldownRemainingMs("deepseek"), 30_000);
});

Deno.test("health: request-level failures never poison provider health", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  for (const code of ["invalid_request", "context_length_exceeded", "content_filtered", "images_unsupported"]) {
    health.recordFailure("groq", { code, retryable: false });
  }
  assert(health.isHealthy("groq"), "the request was broken, not the provider");
  assertEquals(health.snapshot().totals.failure, 0);
});

// ── health: model availability ─────────────────────────────────────────────

Deno.test("health: a retired model id is skipped for a while, then recovers", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t, modelUnavailableTtlMs: 60_000 });
  assert(health.isModelAvailable("gpt-oss-120b"));
  health.recordFailure("groq", { code: "model_unavailable", retryable: true }, "gpt-oss-120b");
  assert(!health.isModelAvailable("gpt-oss-120b"), "stale catalog entry must be skipped");
  assert(health.isHealthy("groq"), "the provider itself is fine");
  clock.t = 60_000;
  assert(health.isModelAvailable("gpt-oss-120b"), "availability must recover automatically");
  health.markModelUnavailable("gpt-4o");
  assert(!health.isModelAvailable("gpt-4o"));
  health.markModelAvailable("gpt-4o");
  assert(health.isModelAvailable("gpt-4o"), "operator can clear a block early");
});

Deno.test("health: snapshots expose counts only — never secrets", () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  health.recordFailure("groq", { code: "provider_error", retryable: true });
  health.recordSuccess("google");
  const snapshot = health.snapshot();
  assertEquals(snapshot.providers, [{ provider: "groq", consecutiveFailures: 1, cooldownRemainingMs: 5_000 }]);
  assertEquals(snapshot.totals, { success: 1, failure: 1, cooldowns: 1 });
  const serialized = show(snapshot);
  for (const key of Object.values(KEYS)) assert(!serialized.includes(key), "key leaked into health snapshot");
});

// ── routing: selectAutoModel ───────────────────────────────────────────────

Deno.test("routing: auto selection keeps the original route preferences when healthy", () => {
  for (const [route, expected] of Object.entries(ROUTE_PREFERENCE)) {
    assertEquals(selectAutoModel(route).id, expected, `route ${route}`);
  }
  assertEquals(selectAutoModel("unknown-route").id, ROUTE_PREFERENCE.conversation);
});

Deno.test("routing: image requests only ever select vision models", () => {
  for (let i = 0; i < 20; i++) {
    const picked = selectAutoModel(i % 2 ? "vision" : "conversation", { hasImages: true });
    assert(picked.supports_vision, `${picked.id} cannot accept images`);
  }
  // Even with a broken preference and cooling-down providers, no text-only model.
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  for (const provider of new Set(MODELS.map(m => m.provider))) {
    health.recordFailure(provider, { code: "provider_error", retryable: true });
  }
  assert(selectAutoModel("fast", { hasImages: true, health }).supports_vision);
});

Deno.test("routing: long-context requests select a model that can hold them", () => {
  const huge = 500_000; // tokens — only the 1M-context models qualify
  const picked = selectAutoModel("conversation", { estimatedContextTokens: huge });
  assert(picked.context_length >= huge, `${picked.id} cannot hold ${huge} tokens`);
  const small = selectAutoModel("fast", { estimatedContextTokens: 10_000 });
  assert(small.context_length >= 10_000);
});

Deno.test("routing: an unhealthy preferred provider yields to a healthy alternative", () => {
  const { health } = failingHealth(["groq", "provider_error"]);
  assertEquals(selectAutoModel("conversation").id, "gpt-oss-120b");
  const picked = selectAutoModel("conversation", { health });
  assert(picked.id !== "gpt-oss-120b", "cooling-down provider must not be picked while healthy options exist");
  assert(health.isHealthy(picked.provider));
});

Deno.test("routing: unavailable catalog entries are never auto-selected", () => {
  const health = new ProviderHealth({ now: () => 0 });
  health.markModelUnavailable("gpt-oss-120b");
  health.markModelUnavailable("gemini-3.7-flash");
  const picked = selectAutoModel("conversation", { health });
  assert(picked.id !== "gpt-oss-120b" && picked.id !== "gemini-3.7-flash");
  // Degrades instead of failing when everything is blocked.
  for (const m of MODELS) health.markModelUnavailable(m.id);
  assert(selectAutoModel("conversation", { health }), "routing must never return nothing");
});

// ── routing: fallbackChain ─────────────────────────────────────────────────

Deno.test("routing: the fallback chain stays request-fitting and health-ordered", () => {
  const { health } = failingHealth(["groq", "provider_error"]);
  const chain = fallbackChain(model("gpt-oss-120b"), false, { health });
  // Primary is always preserved (explicit choice is honoured).
  assertEquals(chain[0].id, "gpt-oss-120b");
  // Healthy alternates come before the cooling-down groq models.
  const firstGroq = chain.findIndex(m => m.provider === "groq" && m.id !== "gpt-oss-120b");
  const firstHealthy = chain.findIndex(m => m.provider !== "groq");
  assert(firstHealthy !== -1);
  assert(firstGroq === -1 || firstHealthy < firstGroq, "healthy providers must be tried first");
  // The chain never collapses to a single entry.
  assert(chain.length > 1, "cooldown must not remove all alternates");
  // Unique ids.
  assertEquals(new Set(chain.map(m => m.id)).size, chain.length);
});

Deno.test("routing: long chats drop small-context alternates but keep the primary", () => {
  const big = 200_000; // tokens
  const chain = fallbackChain(model("gpt-oss-120b"), false, { estimatedContextTokens: big });
  assertEquals(chain[0].id, "gpt-oss-120b", "explicit primary is never dropped");
  for (const alternate of chain.slice(1)) {
    assert(alternate.context_length >= big, `${alternate.id} cannot hold the request`);
  }
  assert(chain.length >= 2, "large-context alternatives should remain");
});

Deno.test("routing: image chains contain only vision-capable models", () => {
  const chain = fallbackChain(model("gemini-3.7-flash"), true);
  assert(chain.every(m => m.supports_vision));
  assert(chain.length >= 1);
});

// ── streamWithFallback × health ────────────────────────────────────────────

async function run(
  chain: ModelSpec[],
  health: ProviderHealth | null,
  handler: (url: string) => Response,
): Promise<{ model: ModelSpec; attempts: Attempt[]; calls: Array<{ url: string }> }> {
  const { fetchImpl, calls } = scriptedFetch(handler);
  const attempts: Attempt[] = [];
  const result = await streamWithFallback(
    chain,
    [{ role: "user", content: "hi" }],
    [],
    { env, fetchImpl, guards, health, onAttempt: a => attempts.push(a) },
  );
  await drain(result.stream.events);
  return { model: result.stream.model, attempts, calls };
}

Deno.test("fallback+health: a cooling-down provider is skipped in favour of a healthy one", async () => {
  const { health } = failingHealth(["groq", "provider_error"]);
  const { model: used, calls } = await run(
    fallbackChain(model("gpt-oss-120b"), false, { health }),
    health,
    (url) => okFor(url),
  );
  assertEquals(used.provider, "google", "healthy provider should answer first");
  assertEquals(calls.length, 1, "the cooling-down provider must not be attempted");
});

Deno.test("fallback+health: outcomes are recorded (failure cools down, success heals)", async () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  // First request: primary groq fails with 503 → cooldown + fallback success.
  const first = await run(fallbackChain(model("gpt-oss-120b"), false, { health }), health, (url) =>
    url.includes("groq") ? new Response("upstream exploded", { status: 503 }) : okFor(url));
  assertEquals(first.model.provider, "google");
  assertEquals(first.attempts.map(a => a.code), ["provider_error"]);
  assert(!health.isHealthy("groq"), "the failing provider must cool down");
  assert(health.isHealthy("google"));

  // Second request: groq is skipped entirely (cooldown), google heals.
  const second = await run(fallbackChain(model("gpt-oss-120b"), false, { health }), health, (url) => okFor(url));
  assertEquals(second.model.provider, "google");
  assertEquals(second.calls.length, 1, "groq must be skipped while cooling down");
  assertEquals(health.snapshot().totals.success, 2);
});

Deno.test("fallback+health: when every provider is cooling down chat still works", async () => {
  const clock = { t: 0 };
  const health = new ProviderHealth({ now: () => clock.t });
  for (const provider of new Set(MODELS.map(m => m.provider))) {
    health.recordFailure(provider, { code: "provider_error", retryable: true });
  }
  const { model: used, calls } = await run(
    fallbackChain(model("gpt-oss-120b"), false, { health }),
    health,
    (url) => okFor(url),
  );
  assertEquals(used.id, "gpt-oss-120b", "degraded mode must still serve the primary");
  assertEquals(calls.length, 1);
});

Deno.test("fallback+health: a retired model id disappears from later chains", async () => {
  const health = new ProviderHealth({ now: () => 0, modelUnavailableTtlMs: 60_000 });
  health.recordFailure("groq", { code: "model_unavailable", retryable: true }, "gpt-oss-120b");
  const chain = fallbackChain(model("openrouter-flint"), false, { health });
  assert(!chain.some(m => m.id === "gpt-oss-120b"), "stale catalog entry must not be offered as a fallback");
  // …and it is excluded from auto-routing too.
  assert(selectAutoModel("conversation", { health }).id !== "gpt-oss-120b");
  // Expired block → entry comes back (catalog refreshed).
  health.markModelAvailable("gpt-oss-120b");
  assert(fallbackChain(model("openrouter-flint"), false, { health }).some(m => m.id === "gpt-oss-120b"));
});

// ── retry budget & concurrency (Phase 3) ───────────────────────────────────

Deno.test("retry budget: maxAttempts bounds the fallback loop", async () => {
  const { fetchImpl, calls } = scriptedFetch(() => new Response("boom", { status: 500 }));
  const attempts: Attempt[] = [];
  let caught: unknown = null;
  try {
    await streamWithFallback(
      fallbackChain(model("gpt-oss-120b"), false),
      [{ role: "user", content: "hi" }],
      [],
      { env, fetchImpl, guards, health: null, maxAttempts: 3, onAttempt: a => attempts.push(a) },
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ProviderError, "a exhausted budget must fail cleanly");
  assertEquals((caught as ProviderError).code, "providers_unavailable");
  assertEquals(attempts.length, 3, "the retry budget caps provider attempts");
  assertEquals(calls.length, 3, "no provider storm beyond the budget");
});

Deno.test("concurrency: saturated providers are steered around while others work", async () => {
  const onlyGroqSaturated = { tryAcquire: (provider: string) => provider !== "groq", release: () => {} };
  const { fetchImpl, calls } = scriptedFetch((url) => okFor(url));
  const result = await streamWithFallback(
    fallbackChain(model("gpt-oss-120b"), false),
    [{ role: "user", content: "hi" }],
    [],
    { env, fetchImpl, guards, health: null, concurrency: onlyGroqSaturated },
  );
  await drain(result.stream.events);
  assertEquals(result.stream.model.provider, "google", "request steered to a free provider");
  assertEquals(calls.length, 1, "the saturated provider was not attempted in pass 1");
});

Deno.test("concurrency: total saturation degrades instead of blocking chat", async () => {
  const denyAll = { tryAcquire: () => false, release: () => {} };
  const { fetchImpl, calls } = scriptedFetch((url) => okFor(url));
  const result = await streamWithFallback(
    fallbackChain(model("gpt-oss-120b"), false),
    [{ role: "user", content: "hi" }],
    [],
    { env, fetchImpl, guards, health: null, concurrency: denyAll },
  );
  await drain(result.stream.events);
  assertEquals(result.stream.model.id, "gpt-oss-120b", "served anyway in degradation mode");
  assertEquals(calls.length, 1);
});
