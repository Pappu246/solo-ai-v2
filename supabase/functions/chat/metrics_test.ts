/**
 * Offline tests for request-level chat metrics.
 *
 * Deterministic: every clock is injected (`now` parameters), nothing touches
 * the network, env or timers. Run with:
 *   deno test supabase/functions/chat/metrics_test.ts
 */
import {
  finishRequest,
  inFlightRequests,
  markFirstToken,
  metricsSnapshot,
  resetMetrics,
  startRequest,
  tagRequest,
  type RequestSummary,
} from "./metrics.ts";

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
/** Deep-equality that ignores object key order (summaries spread tags). */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(sortDeep(actual)) !== JSON.stringify(sortDeep(expected))) {
    throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  }
}

// ── tests ───────────────────────────────────────────────────────────────────

Deno.test("metrics: a finished request reports duration, ttft, tags and volume", () => {
  resetMetrics();
  const events: RequestSummary[] = [];
  startRequest("r1", 1000);
  tagRequest("r1", { model: "gpt-x", provider: "openai", route: "coding" });
  tagRequest("r1", { attempts: 2 });
  markFirstToken("r1", 1250);
  const summary = finishRequest("r1", "ok", { sentChars: 40 }, (s) => events.push(s), 1600);

  assertEquals(summary, {
    event: "request_summary",
    request_id: "r1",
    outcome: "ok",
    durationMs: 600,
    ttftMs: 250,
    model: "gpt-x",
    provider: "openai",
    route: "coding",
    attempts: 2,
    sentChars: 40,
  });
  assertEquals(events.length, 1);
  assertEquals(inFlightRequests(), 0);
});

Deno.test("metrics: only the first token timestamp counts; none streamed means null", () => {
  resetMetrics();
  startRequest("r2", 0);
  markFirstToken("r2", 50);
  markFirstToken("r2", 900); // later deltas must not move the first-token mark
  assertEquals(finishRequest("r2", "ok", {}, undefined, 1000)?.ttftMs, 50);

  startRequest("r3", 0);
  assertEquals(finishRequest("r3", "ok", {}, undefined, 10)?.ttftMs, null);
});

Deno.test("metrics: finish is idempotent, unknown ids are no-ops, emit runs once", () => {
  resetMetrics();
  startRequest("r4", 0);
  assert(finishRequest("r4", "ok", {}, undefined, 1) !== null, "first finish should produce a summary");
  assertEquals(finishRequest("r4", "ok", {}, undefined, 2), null, "second finish must be a no-op");
  assertEquals(finishRequest("ghost", "error", { code: "x" }, undefined, 0), null, "unknown id must be a no-op");

  let emitted = 0;
  startRequest("r5", 0);
  finishRequest("r5", "error", { code: "rate_limited" }, () => emitted++, 1);
  finishRequest("r5", "ok", {}, () => emitted++, 2);
  assertEquals(emitted, 1, "exactly one request_summary per request");
  assertEquals(inFlightRequests(), 0, "the registry must not leak entries");
});

Deno.test("metrics: tags merge per key and touching an unknown id never throws", () => {
  resetMetrics();
  tagRequest("nope", { model: "x" }); // no active request — must not throw
  markFirstToken("nope");

  startRequest("r6", 0);
  tagRequest("r6", { model: "a", provider: "p" });
  tagRequest("r6", { model: "b" }); // later call wins per key, keeps the rest
  const summary = finishRequest("r6", "ok", {}, undefined, 5);
  assertEquals(summary?.model, "b");
  assertEquals(summary?.provider, "p");
});

Deno.test("metrics: clock skew never produces negative latencies", () => {
  resetMetrics();
  startRequest("r7", 1000);
  markFirstToken("r7", 900); // first token "before" start
  const summary = finishRequest("r7", "ok", {}, undefined, 950); // finish "before" start
  assertEquals(summary?.durationMs, 0);
  assertEquals(summary?.ttftMs, 0);
});

Deno.test("metrics: the snapshot counts outcomes, error codes and latencies", () => {
  resetMetrics();
  startRequest("a", 0); markFirstToken("a", 100); finishRequest("a", "ok", { sentChars: 10 }, undefined, 400);
  startRequest("b", 0); finishRequest("b", "error", { code: "rate_limited" }, undefined, 50);
  startRequest("c", 0); finishRequest("c", "error", { code: "rate_limited" }, undefined, 60);
  startRequest("d", 0); finishRequest("d", "error", { code: "provider_timeout" }, undefined, 70);
  startRequest("e", 0); finishRequest("e", "aborted", {}, undefined, 20);

  const snap = metricsSnapshot();
  assertEquals(snap.requests, 5);
  assertEquals(snap.ok, 1);
  assertEquals(snap.errors, 3);
  assertEquals(snap.aborted, 1);
  assertEquals(snap.byCode, { rate_limited: 2, provider_timeout: 1 }, "codes sorted by frequency");
  // durations [400, 50, 60, 70, 20] → sorted [20, 50, 60, 70, 400]
  assertEquals(snap.durationMs, { avg: 120, max: 400, p50: 60, p95: 400 });
  // ttft only samples requests that streamed (a: 100)
  assertEquals(snap.ttftMs, { samples: 1, avg: 100, max: 100, p50: 100, p95: 100 });
});

Deno.test("metrics: reset clears counters, samples and in-flight entries", () => {
  resetMetrics();
  startRequest("x", 0);
  finishRequest("x", "error", { code: "internal_error" }, undefined, 5);
  startRequest("pending", 0); // never finished
  assertEquals(inFlightRequests(), 1);

  resetMetrics();
  assertEquals(inFlightRequests(), 0);
  const snap = metricsSnapshot();
  assertEquals(snap.requests, 0);
  assertEquals(snap.errors, 0);
  assertEquals(snap.byCode, {});
  assertEquals(snap.durationMs, { avg: 0, max: 0, p50: 0, p95: 0 });
  assertEquals(snap.ttftMs, { samples: 0, avg: 0, max: 0, p50: 0, p95: 0 });
});

Deno.test("metrics: an empty snapshot is all zeros (fresh isolate)", () => {
  resetMetrics();
  const snap = metricsSnapshot();
  assertEquals(snap.requests, 0);
  assertEquals(snap.ok, 0);
  assertEquals(snap.aborted, 0);
  assertEquals(snap.durationMs.p95, 0);
  assertEquals(snap.ttftMs.p95, 0);
});
