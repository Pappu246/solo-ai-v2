import { FixedWindowRateLimiter } from "./fixed_window_rate_limit.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(message + ": expected " + expected + ", got " + actual);
}

Deno.test("local rate limit allows the configured count and then denies", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
  assert(limiter.allow("user-a"), "first request should pass");
  assert(limiter.allow("user-a"), "second request should pass");
  assert(limiter.allow("user-a"), "third request should pass");
  assertEquals(limiter.allow("user-a"), false, "fourth request should be throttled");
  assertEquals(limiter.trackedKeyCount, 1, "one user should create one bucket");
});

Deno.test("local rate limit resets an identity when its window expires", () => {
  let now = 10_000;
  const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 500, now: () => now });
  assert(limiter.allow("user-a"), "first request should pass");
  assertEquals(limiter.allow("user-a"), false, "second request should be throttled");
  now += 500;
  assert(limiter.allow("user-a"), "request should pass after the window expires");
  assertEquals(limiter.trackedKeyCount, 1, "expired bucket is replaced, not duplicated");
});

Deno.test("local rate limit bounds memory and denies new keys when full", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({
    limit: 2,
    windowMs: 60_000,
    maxEntries: 2,
    cleanupIntervalMs: 60_000,
    capacitySweepIntervalMs: 1_000,
    now: () => now,
  });

  assert(limiter.allow("user-a"), "first identity should pass");
  assert(limiter.allow("user-b"), "second identity should pass");
  assertEquals(limiter.trackedKeyCount, 2, "map should reach but not exceed capacity");
  assertEquals(limiter.allow("user-c"), false, "new identity should be denied at capacity");
  assertEquals(limiter.trackedKeyCount, 2, "map must remain bounded");

  now += 60_000;
  assert(limiter.allow("user-c"), "expired identities should be reclaimed at capacity");
  assertEquals(limiter.trackedKeyCount, 1, "expired buckets should be swept before adding a key");
});

Deno.test("local rate limit rejects empty identifiers and validates configuration", () => {
  const limiter = new FixedWindowRateLimiter({ now: () => 1 });
  assertEquals(limiter.allow(""), false, "empty identities are rejected");
  let threw = false;
  try {
    new FixedWindowRateLimiter({ maxEntries: 0 });
  } catch {
    threw = true;
  }
  assert(threw, "zero capacity must be rejected at construction");
});
