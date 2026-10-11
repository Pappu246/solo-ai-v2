/**
 * Small per-isolate fixed-window limiter with bounded memory.
 *
 * This is only a secondary safety net around the persistent usage budgets.
 * When the map reaches capacity, a new identity is denied until an expired
 * bucket can be reclaimed; existing identities remain subject to their limit.
 * Sweeps run periodically, and more frequently only while at capacity.
 */
export interface FixedWindowRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  maxEntries?: number;
  cleanupIntervalMs?: number;
  capacitySweepIntervalMs?: number;
  now?: () => number;
}

interface Bucket {
  startedAt: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly cleanupIntervalMs: number;
  private readonly capacitySweepIntervalMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();
  private lastCleanupAt: number;

  constructor(options: FixedWindowRateLimiterOptions = {}) {
    this.limit = positiveInteger(options.limit ?? 30, "limit");
    this.windowMs = positiveInteger(options.windowMs ?? 60_000, "windowMs");
    this.maxEntries = positiveInteger(options.maxEntries ?? 20_000, "maxEntries");
    this.cleanupIntervalMs = positiveInteger(options.cleanupIntervalMs ?? 60_000, "cleanupIntervalMs");
    this.capacitySweepIntervalMs = positiveInteger(options.capacitySweepIntervalMs ?? 1_000, "capacitySweepIntervalMs");
    this.now = options.now ?? (() => Date.now());
    this.lastCleanupAt = this.now();
  }

  /** Returns true when the key may proceed; false when throttled or at capacity. */
  allow(key: string): boolean {
    if (typeof key !== "string" || !key.length) return false;

    const now = this.now();
    const atCapacity = this.buckets.size >= this.maxEntries;
    const cleanupDue = now - this.lastCleanupAt >= this.cleanupIntervalMs;
    const capacitySweepDue = atCapacity && now - this.lastCleanupAt >= this.capacitySweepIntervalMs;

    if (cleanupDue || capacitySweepDue) this.sweepExpired(now);

    let bucket = this.buckets.get(key);
    if (bucket && now - bucket.startedAt >= this.windowMs) {
      this.buckets.delete(key);
      bucket = undefined;
    }

    if (!bucket) {
      if (this.buckets.size >= this.maxEntries) return false;
      this.buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }

    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }

  /** Exposes only a count, useful for metrics and deterministic tests. */
  get trackedKeyCount(): number {
    return this.buckets.size;
  }

  private sweepExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
    this.lastCleanupAt = now;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive safe integer");
  }
  return value;
}
