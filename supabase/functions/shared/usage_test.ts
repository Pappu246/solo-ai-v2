/**
 * Offline tests for the usage / cost controls (Phase 3).
 *
 * Deterministic: injected clock, fake RPC client, no network. Run with:
 *   deno test supabase/functions/shared/usage_test.ts
 */
import {
  createUsageController,
  DEFAULT_LIMITS,
  FallbackUsageStore,
  limitsFromEnv,
  MemoryUsageStore,
  ProviderConcurrency,
  SupabaseUsageStore,
  UsageController,
  type ConsumeInput,
  type RpcClient,
  type UsageLimits,
} from "./usage.ts";

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

const MINUTE = 60_000;
const DAY = 86_400_000;

function controllerWith(limits: Partial<UsageLimits> = {}) {
  const clock = { t: 1_000_000 };
  const memory = new MemoryUsageStore(() => clock.t);
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const controller = new UsageController(memory, {
    limits: { ...DEFAULT_LIMITS, chatPerMinute: 0, chatPerDay: 0, chatTokensPerDay: 0, imageSearchPerMinute: 0, imageSearchPerDay: 0, ...limits },
    onEvent: (event, fields) => events.push({ event, fields }),
  });
  return { controller, clock, events, memory };
}

// ── budgets: normal request, limits, reset ─────────────────────────────────

Deno.test("usage: normal requests are allowed and counted", async () => {
  const { controller, memory } = controllerWith({ chatPerMinute: 3 });
  for (let i = 0; i < 3; i++) {
    const decision = await controller.checkChat("user-1");
    assertEquals(decision.allowed, true, `request ${i} should pass`);
  }
  const bucket = await memory.consume({ userId: "user-1", scope: "chat_minute", limit: 99, windowSeconds: 60, amount: 0 });
  assertEquals(bucket.count, 3, "exactly one unit per request");
  // Other users are unaffected (per-user isolation).
  const other = await memory.consume({ userId: "user-2", scope: "chat_minute", limit: 99, windowSeconds: 60, amount: 0 });
  assertEquals(other.count, 0);
});

Deno.test("usage: the minute limit is enforced and resets with the window", async () => {
  const { controller, clock } = controllerWith({ chatPerMinute: 2 });
  // Align to the start of a minute window so all assertions share one bucket.
  clock.t = Math.ceil(clock.t / MINUTE) * MINUTE;
  assertEquals((await controller.checkChat("u")).allowed, true);
  assertEquals((await controller.checkChat("u")).allowed, true);
  const denied = await controller.checkChat("u");
  assertEquals(denied, { allowed: false, reason: "minute" });
  // Still denied inside the same window.
  clock.t += MINUTE - 1;
  assertEquals((await controller.checkChat("u")).allowed, false);
  // Next window resets (no permanent lockout).
  clock.t = Math.ceil(clock.t / MINUTE) * MINUTE;
  assertEquals((await controller.checkChat("u")).allowed, true);
});

Deno.test("usage: the daily request budget is enforced and resets daily", async () => {
  const { controller, clock, events } = controllerWith({ chatPerDay: 2 });
  assertEquals((await controller.checkChat("u")).allowed, true);
  assertEquals((await controller.checkChat("u")).allowed, true);
  const denied = await controller.checkChat("u");
  assertEquals(denied, { allowed: false, reason: "day" });
  assertEquals(events.at(-1), { event: "usage_limit_reached", fields: { scope: "chat", reason: "day" } });
  clock.t += DAY;
  assertEquals((await controller.checkChat("u")).allowed, true, "daily budget resets");
});

Deno.test("usage: concurrent callers cannot collectively exceed the limit", async () => {
  const { controller } = controllerWith({ chatPerMinute: 10 });
  const decisions = await Promise.all(
    Array.from({ length: 20 }, () => controller.checkChat("burst-user")),
  );
  const allowed = decisions.filter(d => d.allowed).length;
  assertEquals(allowed, 10, "exactly the limit may pass under concurrency");
  assertEquals(decisions.filter(d => !d.allowed).length, 10);
});

Deno.test("usage: 0 disables a check (env contract)", async () => {
  assertEquals(limitsFromEnv(name => name === "USAGE_CHAT_PER_DAY" ? "0" : undefined).chatPerDay, 0);
  assertEquals(limitsFromEnv(name => name === "USAGE_CHAT_PER_MINUTE" ? "25" : undefined).chatPerMinute, 25);
  assertEquals(limitsFromEnv(name => name === "USAGE_CHAT_PER_MINUTE" ? "nonsense" : undefined).chatPerMinute, DEFAULT_LIMITS.chatPerMinute);
  const { controller } = controllerWith(); // everything disabled
  for (let i = 0; i < 100; i++) assertEquals((await controller.checkChat("u")).allowed, true);
});

// ── token budget ───────────────────────────────────────────────────────────

Deno.test("usage: token accounting gates new requests once the budget is spent", async () => {
  const { controller, events } = controllerWith({ chatTokensPerDay: 1_000 });
  await controller.recordTokens("u", 600);
  assertEquals((await controller.checkChat("u")).allowed, true, "600/1000 tokens used");
  await controller.recordTokens("u", 400);
  const denied = await controller.checkChat("u");
  assertEquals(denied, { allowed: false, reason: "tokens" });
  // Over-budget recordings are refused and reported (no silent overshoot).
  const recorded = await controller.recordTokens("u", 500);
  assertEquals(recorded, { count: 1_000, allowed: false });
  assert(events.some(e => e.event === "usage_tokens_over_budget"));
  // The recorded total never exceeds the budget.
  assertEquals(events.filter(e => e.event === "usage_tokens_over_budget").length >= 1, true);
});

Deno.test("usage: token accounting is disabled cleanly when the limit is 0", async () => {
  const { controller } = controllerWith({ chatTokensPerDay: 0 });
  await controller.recordTokens("u", 10_000_000); // still accounted, never enforced
  assertEquals((await controller.checkChat("u")).allowed, true);
});

// ── image search budgets ───────────────────────────────────────────────────

Deno.test("usage: image search enforces its own tighter budgets", async () => {
  const { controller, clock } = controllerWith({ imageSearchPerMinute: 1, imageSearchPerDay: 3 });
  assertEquals((await controller.checkImageSearch("u")).allowed, true);
  assertEquals(await controller.checkImageSearch("u"), { allowed: false, reason: "minute" });
  clock.t += MINUTE;
  assertEquals((await controller.checkImageSearch("u")).allowed, true);
  clock.t += MINUTE;
  assertEquals((await controller.checkImageSearch("u")).allowed, true);
  clock.t += MINUTE;
  assertEquals(await controller.checkImageSearch("u"), { allowed: false, reason: "day" }, "daily cap");
  // Chat budgets are independent of image budgets.
  assertEquals((await controller.checkChat("u")).allowed, true);
});

// ── degradation paths ──────────────────────────────────────────────────────

Deno.test("usage: a failing persistent store degrades to the memory layer", async () => {
  const clock = { t: 0 };
  const memory = new MemoryUsageStore(() => clock.t);
  const errors: unknown[] = [];
  const broken: { consume(input: ConsumeInput): Promise<never> } = {
    consume: async () => { throw new Error("database unavailable"); },
  };
  const store = new FallbackUsageStore(broken, memory, error => errors.push(error));
  const controller = new UsageController(store, {
    limits: { ...DEFAULT_LIMITS, chatPerMinute: 1, chatPerDay: 0, chatTokensPerDay: 0, imageSearchPerMinute: 0, imageSearchPerDay: 0 },
  });
  assertEquals((await controller.checkChat("u")).allowed, true);
  const second = await controller.checkChat("u");
  assertEquals(second, { allowed: false, reason: "minute" }, "fallback still enforces");
  assertEquals(errors.length, 2, "every fallback use is reported");
});

Deno.test("usage: with no working store at all the request is allowed and logged", async () => {
  const events: string[] = [];
  const controller = new UsageController(
    { consume: async () => { throw new Error("down"); } },
    { limits: DEFAULT_LIMITS, onEvent: event => events.push(event) },
  );
  assertEquals((await controller.checkChat("u")).allowed, true, "degrade to allowed, never hard-fail chat");
  assert(events.includes("usage_store_error"));
  assertEquals(await controller.recordTokens("u", 42), null, "accounting failure is swallowed and logged");
  assert(events.includes("record_tokens"));
});

// ── Supabase RPC contract ──────────────────────────────────────────────────

Deno.test("usage: the RPC store sends the full contract and parses the row", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: RpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: [{ used_count: 7, allowed: true }], error: null };
    },
  };
  const store = new SupabaseUsageStore(client);
  const result = await store.consume({
    userId: "user-123", scope: "chat_minute", limit: 30, windowSeconds: 60, amount: 1, tokens: 0,
  });
  assertEquals(result, { count: 7, allowed: true });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "consume_usage");
  assertEquals(calls[0].args, {
    p_user_id: "user-123",
    p_scope: "chat_minute",
    p_limit: 30,
    p_window_seconds: 60,
    p_amount: 1,
    p_tokens: 0,
  });
});

Deno.test("usage: an RPC error surfaces as a store failure (caller degrades)", async () => {
  const client: RpcClient = { rpc: async () => ({ data: null, error: { message: "permission denied" } }) };
  const store = new SupabaseUsageStore(client);
  let caught: unknown = null;
  try {
    await store.consume({ userId: "u", scope: "chat_day", limit: 10, windowSeconds: 86_400 });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error);
  assertStringIncludes(caught.message, "usage store unavailable");
  // The error text never echoes caller data back beyond the store message.
  assertEquals(caught.message.includes("undefined"), false);
});

function assertStringIncludes(actual: string, expected: string, message?: string): void {
  if (!actual.includes(expected)) throw new AssertionError(message ?? `expected ${show(actual)} to include ${show(expected)}`);
}

// ── provider concurrency gauge ─────────────────────────────────────────────

Deno.test("concurrency: the provider gauge caps, releases and reports counts", () => {
  const limiter = new ProviderConcurrency(2);
  assertEquals(limiter.tryAcquire("groq"), true);
  assertEquals(limiter.tryAcquire("groq"), true);
  assertEquals(limiter.tryAcquire("groq"), false, "per-provider cap enforced");
  assertEquals(limiter.tryAcquire("google"), true, "other providers unaffected");
  limiter.release("groq");
  assertEquals(limiter.tryAcquire("groq"), true, "released slot is reusable");
  assertEquals(limiter.activeFor("groq"), 2);
  assertEquals(limiter.snapshot(), { google: 1, groq: 2 });
  limiter.release("groq");
  limiter.release("groq");
  limiter.release("groq"); // over-release is harmless
  assertEquals(limiter.activeFor("groq"), 0);
});

// ── factory ────────────────────────────────────────────────────────────────

Deno.test("usage: without an RPC client the controller still enforces in memory", async () => {
  const events: string[] = [];
  const controller = createUsageController(null, {
    limits: { ...DEFAULT_LIMITS, chatPerMinute: 1, chatPerDay: 0, chatTokensPerDay: 0, imageSearchPerMinute: 0, imageSearchPerDay: 0 },
    onEvent: event => events.push(event),
    memoryStore: new MemoryUsageStore(() => 0),
  });
  assertEquals((await controller.checkChat("u")).allowed, true);
  assertEquals((await controller.checkChat("u")).allowed, false);
  assertEquals(
    events.filter(e => e === "usage_store_error" || e === "usage_store_fallback"),
    [],
    "no store-error events — the in-memory path is intentional, not a failure",
  );
  assert(events.includes("usage_limit_reached"), "limits are still reported normally");
});
