/**
 * Request-level observability metrics for the `chat` Edge Function.
 *
 * Design goals (mirrors health.ts):
 *  - one structured `request_summary` event per chat request: how long it
 *    took, how long until the first streamed token, which model/provider/route
 *    served it, how many attempts it needed, and how it ended
 *  - in-isolate aggregate counters (counts only) exposed through
 *    `metricsSnapshot()` — never message content, prompts, user ids or keys,
 *    so a snapshot is safe to log or expose
 *  - idempotent: `finishRequest` logs at most once per request, so the many
 *    exit paths of the handler (fail / abort / stream close) can all call it
 *  - dependency-injected clock and emitter so tests are deterministic
 *
 * Counters are per-isolate (Edge isolates do not share memory); each isolate
 * reports its own window, which is the same model the rate limiter and the
 * image-search cache already use.
 */

export type RequestOutcome = "ok" | "error" | "aborted";

/** Best-effort routing tags, set as the request is resolved. */
export interface RequestTags {
  model?: string;
  provider?: string;
  route?: string;
  attempts?: number;
}

/** Extra facts known at the exit path. */
export interface RequestFinish {
  code?: string;
  status?: number;
  sentChars?: number;
}

/**
 * The `request_summary` log event. Counts only — safe to log verbatim.
 * Deliberately a flat type alias (not an interface) so it carries an implicit
 * index signature and is assignable to the logger's `Record<string, unknown>`.
 */
export type RequestSummary = {
  event: "request_summary";
  request_id: string;
  outcome: RequestOutcome;
  /** Total handler time, from `startRequest` to the exit path. */
  durationMs: number;
  /** Time until the first streamed content token; null when none streamed. */
  ttftMs: number | null;
  model?: string;
  provider?: string;
  route?: string;
  attempts?: number;
  code?: string;
  status?: number;
  sentChars?: number;
};

export interface MetricStat {
  avg: number;
  max: number;
  p50: number;
  p95: number;
}

export interface MetricsSnapshot {
  requests: number;
  ok: number;
  errors: number;
  aborted: number;
  /** Error counts keyed by failure code, highest first. */
  byCode: Record<string, number>;
  durationMs: MetricStat;
  /** Time-to-first-token, across requests that streamed content only. */
  ttftMs: MetricStat & { samples: number };
}

interface InFlight {
  startedAt: number;
  firstTokenAt: number | null;
  tags: RequestTags;
}

/** Rolling sample window for percentiles (bounded memory per isolate). */
const SAMPLE_CAP = 256;

const inFlight = new Map<string, InFlight>();
const durations: number[] = [];
const ttfts: number[] = [];
const byCode = new Map<string, number>();
const totals = {
  requests: 0,
  ok: 0,
  errors: 0,
  aborted: 0,
  durationSum: 0,
  durationMax: 0,
  ttftSum: 0,
  ttftMax: 0,
  ttftCount: 0,
};

/** Begin timing a request. Overwrites any previous entry for the same id. */
export function startRequest(requestId: string, now: number = Date.now()): void {
  inFlight.set(requestId, { startedAt: now, firstTokenAt: null, tags: {} });
}

/** Record the first streamed content token (only the first call counts). */
export function markFirstToken(requestId: string, now: number = Date.now()): void {
  const active = inFlight.get(requestId);
  if (active && active.firstTokenAt === null) active.firstTokenAt = now;
}

/** Merge routing tags into the in-flight request (later calls win per key). */
export function tagRequest(requestId: string, tags: RequestTags): void {
  const active = inFlight.get(requestId);
  if (!active) return;
  for (const [k, v] of Object.entries(tags)) {
    if (v !== undefined) (active.tags as Record<string, unknown>)[k] = v;
  }
}

/**
 * Finish a request: update aggregates and emit `summary` at most once.
 * Returns null for unknown or already-finished ids, so every exit path of the
 * handler can call it unconditionally (no-op when someone else got there first).
 */
export function finishRequest(
  requestId: string,
  outcome: RequestOutcome,
  extra: RequestFinish = {},
  emit?: (summary: RequestSummary) => void,
  now: number = Date.now(),
): RequestSummary | null {
  const active = inFlight.get(requestId);
  if (!active) return null;
  inFlight.delete(requestId);

  const durationMs = Math.max(0, now - active.startedAt);
  const ttftMs = active.firstTokenAt === null ? null : Math.max(0, active.firstTokenAt - active.startedAt);

  const summary: RequestSummary = {
    event: "request_summary",
    request_id: requestId,
    outcome,
    durationMs,
    ttftMs,
    ...active.tags,
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.status !== undefined ? { status: extra.status } : {}),
    ...(extra.sentChars !== undefined ? { sentChars: extra.sentChars } : {}),
  };

  totals.requests++;
  if (outcome === "ok") totals.ok++;
  else if (outcome === "aborted") totals.aborted++;
  else {
    totals.errors++;
    const key = extra.code ?? "unknown";
    byCode.set(key, (byCode.get(key) ?? 0) + 1);
  }
  totals.durationSum += durationMs;
  if (durationMs > totals.durationMax) totals.durationMax = durationMs;
  pushSample(durations, durationMs);
  if (ttftMs !== null) {
    totals.ttftSum += ttftMs;
    totals.ttftCount++;
    if (ttftMs > totals.ttftMax) totals.ttftMax = ttftMs;
    pushSample(ttfts, ttftMs);
  }

  emit?.(summary);
  return summary;
}

/** Counts-only aggregate view — safe to log or expose; no user data. */
export function metricsSnapshot(): MetricsSnapshot {
  const requests = totals.requests;
  return {
    requests,
    ok: totals.ok,
    errors: totals.errors,
    aborted: totals.aborted,
    byCode: Object.fromEntries([...byCode].sort((a, b) => b[1] - a[1])),
    durationMs: {
      avg: requests ? round(totals.durationSum / requests) : 0,
      max: totals.durationMax,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    ttftMs: {
      samples: totals.ttftCount,
      avg: totals.ttftCount ? round(totals.ttftSum / totals.ttftCount) : 0,
      max: totals.ttftMax,
      p50: percentile(ttfts, 0.5),
      p95: percentile(ttfts, 0.95),
    },
  };
}

/** Requests currently being timed (leak check for tests). */
export function inFlightRequests(): number {
  return inFlight.size;
}

/** Reset every counter and sample — tests only. */
export function resetMetrics(): void {
  inFlight.clear();
  durations.length = 0;
  ttfts.length = 0;
  byCode.clear();
  totals.requests = 0;
  totals.ok = 0;
  totals.errors = 0;
  totals.aborted = 0;
  totals.durationSum = 0;
  totals.durationMax = 0;
  totals.ttftSum = 0;
  totals.ttftMax = 0;
  totals.ttftCount = 0;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_CAP) samples.splice(0, samples.length - SAMPLE_CAP);
}

function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return round(sorted[index]);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
