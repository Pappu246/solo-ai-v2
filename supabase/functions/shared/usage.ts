/**
 * Persistent usage / cost controls for the Edge Functions (Phase 3).
 *
 * Layers (free-first, safe degradation — never a single point of failure):
 *   1. `SupabaseUsageStore` — atomic windowed counters in Postgres via the
 *      `consume_usage` RPC (see migrations/20261007120000_usage_controls.sql).
 *      This is the authority: it holds across isolates and concurrent callers.
 *   2. `MemoryUsageStore` — in-memory buckets used only when the persistent
 *      store is unreachable, so an outage degrades to per-isolate enforcement
 *      instead of disabling protection entirely.
 *   3. In-process concurrency gauges (`ProviderConcurrency`) — best-effort
 *      per-isolate caps that prevent a provider storm inside one isolate.
 *
 * Everything is dependency-injected (store, clock, limits) so the offline
 * test suite (`usage_test.ts`) is deterministic. No secrets are ever logged:
 * the controller reports scope names, counts and reasons only.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface UsageLimits {
  /** Chat requests per user per minute. */
  chatPerMinute: number;
  /** Chat requests per user per day. */
  chatPerDay: number;
  /** Estimated output tokens per user per day; 0 disables the check. */
  chatTokensPerDay: number;
  /** Image-search requests per user per minute. */
  imageSearchPerMinute: number;
  /** Image-search requests per user per day. */
  imageSearchPerDay: number;
}

export const DEFAULT_LIMITS: UsageLimits = {
  chatPerMinute: 30,
  chatPerDay: 1_000,
  chatTokensPerDay: 2_000_000,
  imageSearchPerMinute: 10,
  imageSearchPerDay: 200,
};

export type EnvReader = (name: string) => string | undefined;

function intFromEnv(env: EnvReader, name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Limits with env overrides (`USAGE_*`); 0 disables that check. */
export function limitsFromEnv(env: EnvReader = () => undefined): UsageLimits {
  return {
    chatPerMinute: Math.min(intFromEnv(env, "USAGE_CHAT_PER_MINUTE", DEFAULT_LIMITS.chatPerMinute), 10_000),
    chatPerDay: Math.min(intFromEnv(env, "USAGE_CHAT_PER_DAY", DEFAULT_LIMITS.chatPerDay), 1_000_000),
    chatTokensPerDay: Math.min(intFromEnv(env, "USAGE_CHAT_TOKENS_PER_DAY", DEFAULT_LIMITS.chatTokensPerDay), 1_000_000_000),
    imageSearchPerMinute: Math.min(intFromEnv(env, "USAGE_IMAGE_PER_MINUTE", DEFAULT_LIMITS.imageSearchPerMinute), 10_000),
    imageSearchPerDay: Math.min(intFromEnv(env, "USAGE_IMAGE_PER_DAY", DEFAULT_LIMITS.imageSearchPerDay), 1_000_000),
  };
}

export interface ConsumeInput {
  userId: string;
  scope: string;
  limit: number;
  windowSeconds: number;
  /** How much to add (requests = 1, tokens = estimated size). Default 1. */
  amount?: number;
  /** Tokens mirrored into the same row for accounting/observability. */
  tokens?: number;
}

export interface ConsumeResult {
  count: number;
  allowed: boolean;
}

export interface UsageStore {
  /** Atomically add `amount` when the result stays within `limit`. */
  consume(input: ConsumeInput): Promise<ConsumeResult>;
}

// ── Stores ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural view of a Supabase client (only `.rpc` is used).
 * `PromiseLike` (not `Promise`) so the real PostgREST builder fits.
 */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/** Persistent store: calls the `consume_usage` RPC (user JWT, no service key). */
export class SupabaseUsageStore implements UsageStore {
  constructor(private readonly client: RpcClient) {}

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    const { data, error } = await this.client.rpc("consume_usage", {
      p_user_id: input.userId,
      p_scope: input.scope,
      p_limit: input.limit,
      p_window_seconds: input.windowSeconds,
      p_amount: input.amount ?? 1,
      p_tokens: input.tokens ?? 0,
    });
    if (error) throw new Error(`usage store unavailable: ${error.message ?? "rpc error"}`);
    const row = (Array.isArray(data) ? data[0] : data) as { used_count?: unknown; allowed?: unknown } | null;
    if (!row || typeof row !== "object") throw new Error("usage store returned no row");
    return { count: Number(row.used_count ?? 0), allowed: Boolean(row.allowed) };
  }
}

interface MemoryBucket {
  count: number;
  tokens: number;
  expiresAt: number;
}

/** Per-isolate fallback + offline tests. Deterministic with an injected clock. */
export class MemoryUsageStore implements UsageStore {
  private readonly buckets = new Map<string, MemoryBucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    const key = `${input.userId}:${input.scope}:${Math.floor(this.now() / (input.windowSeconds * 1000))}`;
    const amount = Math.max(0, input.amount ?? 1);
    const tokens = Math.max(0, input.tokens ?? 0);

    let bucket = this.buckets.get(key);
    if (bucket && this.now() >= bucket.expiresAt) {
      this.buckets.delete(key);
      bucket = undefined;
    }

    // Pure check (amount = 0): allowed while any budget remains.
    if (amount === 0) {
      const count = bucket?.count ?? 0;
      return { count, allowed: count < input.limit };
    }

    if (!bucket) {
      if (amount > input.limit) return { count: 0, allowed: false };
      const created: MemoryBucket = { count: amount, tokens, expiresAt: this.now() + input.windowSeconds * 1000 * 2 };
      this.buckets.set(key, created);
      return { count: created.count, allowed: true };
    }

    if (bucket.count + amount > input.limit) return { count: bucket.count, allowed: false };
    bucket.count += amount;
    bucket.tokens += tokens;
    return { count: bucket.count, allowed: true };
  }

  /** Test/diagnostic helper: drop all buckets (does not touch other stores). */
  clear(): void {
    this.buckets.clear();
  }
}

/** Persistent-primary, memory-fallback: a store outage never disables limits. */
export class FallbackUsageStore implements UsageStore {
  constructor(
    private readonly primary: UsageStore | null,
    private readonly fallback: UsageStore,
    private readonly onPrimaryError?: (error: unknown) => void,
  ) {}

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    if (!this.primary) return this.fallback.consume(input);
    try {
      return await this.primary.consume(input);
    } catch (error) {
      this.onPrimaryError?.(error);
      return this.fallback.consume(input);
    }
  }
}

// ── Controller ──────────────────────────────────────────────────────────────

export type UsageDenyReason = "minute" | "day" | "tokens";

export type ChatUsageDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: UsageDenyReason };

export type ImageUsageDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: UsageDenyReason };

const MINUTE = 60;
const DAY = 86_400;
/** Accounting-only budget when the token limit is disabled. */
const ACCOUNTING_LIMIT = 1_000_000_000_000;

export interface UsageControllerOptions {
  limits?: UsageLimits;
  /** Privacy-safe telemetry: scope, reason and counts only — never content. */
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
}

/**
 * Enforces the request/token budgets for one logical caller. Stores are
 * shared; limits are configurable; every failure path is logged as an event
 * and degrades instead of throwing.
 */
export class UsageController {
  readonly limits: UsageLimits;
  private readonly onEvent: (event: string, fields: Record<string, unknown>) => void;

  constructor(private readonly store: UsageStore, options: UsageControllerOptions = {}) {
    this.limits = options.limits ?? DEFAULT_LIMITS;
    this.onEvent = options.onEvent ?? (() => {});
  }

  /** Chat: token budget (check) → per-minute burst → daily request budget. */
  async checkChat(userId: string): Promise<ChatUsageDecision> {
    const limits = this.limits;
    if (limits.chatTokensPerDay > 0) {
      const tokens = await this.safe({ userId, scope: "chat_tokens", limit: limits.chatTokensPerDay, windowSeconds: DAY, amount: 0 });
      if (tokens && !tokens.allowed) return this.deny("tokens", "chat");
    }
    if (limits.chatPerMinute > 0) {
      const minute = await this.safe({ userId, scope: "chat_minute", limit: limits.chatPerMinute, windowSeconds: MINUTE });
      if (minute && !minute.allowed) return this.deny("minute", "chat");
    }
    if (limits.chatPerDay > 0) {
      const day = await this.safe({ userId, scope: "chat_day", limit: limits.chatPerDay, windowSeconds: DAY });
      if (day && !day.allowed) return this.deny("day", "chat");
    }
    return { allowed: true, reason: null };
  }

  /** Image search: tighter budgets (free-tier provider quota is tiny). */
  async checkImageSearch(userId: string): Promise<ImageUsageDecision> {
    const limits = this.limits;
    if (limits.imageSearchPerMinute > 0) {
      const minute = await this.safe({ userId, scope: "image_minute", limit: limits.imageSearchPerMinute, windowSeconds: MINUTE });
      if (minute && !minute.allowed) return this.deny("minute", "image_search");
    }
    if (limits.imageSearchPerDay > 0) {
      const day = await this.safe({ userId, scope: "image_day", limit: limits.imageSearchPerDay, windowSeconds: DAY });
      if (day && !day.allowed) return this.deny("day", "image_search");
    }
    return { allowed: true, reason: null };
  }

  /**
   * Account estimated output tokens after a completed stream (best-effort:
   * failures are logged, never surfaced to the user).
   */
  async recordTokens(userId: string, estimatedTokens: number): Promise<ConsumeResult | null> {
    const tokens = Math.max(0, Math.ceil(estimatedTokens));
    if (!tokens) return null;
    const limit = this.limits.chatTokensPerDay > 0 ? this.limits.chatTokensPerDay : ACCOUNTING_LIMIT;
    const result = await this.safe({
      userId,
      scope: "chat_tokens",
      limit,
      windowSeconds: DAY,
      // `amount` drives enforcement (count tracks cumulative tokens);
      // `tokens` mirrors it for accounting/observability.
      amount: tokens,
      tokens,
    }, "record_tokens");
    if (result && !result.allowed) this.onEvent("usage_tokens_over_budget", { scope: "chat_tokens" });
    return result;
  }

  private deny(reason: UsageDenyReason, scope: string): { allowed: false; reason: UsageDenyReason } {
    this.onEvent("usage_limit_reached", { scope, reason });
    return { allowed: false, reason };
  }

  /** null = the store failed entirely; callers degrade to allowed. */
  private async safe(input: ConsumeInput, event = "usage_store_error"): Promise<ConsumeResult | null> {
    try {
      return await this.store.consume(input);
    } catch (error) {
      this.onEvent(event, { scope: input.scope, error: error instanceof Error ? error.name : "unknown" });
      return null;
    }
  }
}

// ── Provider concurrency (per-isolate, best-effort) ─────────────────────────

/**
 * In-process concurrency gauge per provider. Complements (never replaces)
 * the persistent budgets: it stops one isolate from opening an unbounded
 * number of simultaneous streams against a single provider.
 */
export class ProviderConcurrency {
  private readonly active = new Map<string, number>();

  constructor(private readonly limitPerProvider: number = 8) {}

  tryAcquire(provider: string): boolean {
    const current = this.active.get(provider) ?? 0;
    if (current >= this.limitPerProvider) return false;
    this.active.set(provider, current + 1);
    return true;
  }

  release(provider: string): void {
    const current = this.active.get(provider) ?? 0;
    if (current <= 1) this.active.delete(provider);
    else this.active.set(provider, current - 1);
  }

  activeFor(provider: string): number {
    return this.active.get(provider) ?? 0;
  }

  /** Counts only — safe for admin/debug metrics. */
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.active.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build a controller for one request. `rpcClient` must carry the caller's
 * JWT (the RPC authorizes against `auth.uid()`); when it is null — e.g. the
 * publishable key could not be resolved — protection falls back to the
 * in-memory store rather than disappearing.
 */
export function createUsageController(rpcClient: RpcClient | null, options: UsageControllerOptions & { memoryStore?: UsageStore } = {}): UsageController {
  const memory = options.memoryStore ?? sharedMemoryStore;
  const primary = rpcClient ? new SupabaseUsageStore(rpcClient) : null;
  const store = new FallbackUsageStore(primary, memory, error =>
    options.onEvent?.("usage_store_fallback", { error: error instanceof Error ? error.name : "unknown" }));
  return new UsageController(store, options);
}

/** Shared across requests inside one isolate (fallback layer only). */
export const sharedMemoryStore = new MemoryUsageStore();
