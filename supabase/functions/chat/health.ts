/**
 * Provider / model health tracking for the `chat` Edge Function.
 *
 * Design goals (free-first, safe degradation):
 *  - a provider that keeps failing is put on a *temporary* cooldown so
 *    concurrent and sequential requests do not hammer it (no provider storm)
 *  - cooldowns always expire — a transient failure never disables a provider
 *    permanently, and a success clears the slate
 *  - stale catalog entries can be marked unavailable for a while so routing
 *    skips them, without editing the static catalog
 *  - snapshots expose counts only: never keys, bodies, prompts or user data
 *
 * The class is dependency-injected (`now`) so tests are deterministic, and it
 * is structurally compatible with the `HealthTracker` interface consumed by
 * `providers.ts` (no import cycle).
 */

export interface HealthOutcome {
  code: string;
  retryable: boolean;
}

export interface ProviderHealthSnapshot {
  provider: string;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
}

export interface ModelAvailabilitySnapshot {
  modelId: string;
  remainingMs: number;
}

/** Failure codes caused by the *request*, not the provider — never recorded. */
const REQUEST_LEVEL_CODES = new Set([
  "invalid_request",
  "context_length_exceeded",
  "content_filtered",
  "images_unsupported",
]);

/** Model-level codes: the provider is fine, the catalog entry is stale. */
const MODEL_LEVEL_CODES = new Set(["model_unavailable"]);

/** Per-code starting cooldown. All of them expire; none is permanent. */
const COOLDOWN_BASE_MS: Record<string, number> = {
  rate_limited: 15_000,
  provider_auth: 30_000,
  provider_not_configured: 30_000,
  provider_payment: 30_000,
  provider_timeout: 10_000,
  empty_response: 10_000,
};

const DEFAULT_COOLDOWN_BASE_MS = 5_000;
const MAX_COOLDOWN_MS = 120_000;
const MODEL_UNAVAILABLE_TTL_MS = 300_000;

export interface ProviderHealthOptions {
  now?: () => number;
  /** Hard cap for any cooldown — the "never permanent" guarantee. */
  maxCooldownMs?: number;
  /** Default TTL when a model is marked unavailable without an explicit one. */
  modelUnavailableTtlMs?: number;
}

export class ProviderHealth {
  private readonly now: () => number;
  private readonly maxCooldownMs: number;
  private readonly modelTtlMs: number;

  private readonly failures = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly unavailableModels = new Map<string, number>();
  private successCount = 0;
  private failureCount = 0;
  private cooldownCount = 0;

  constructor(options: ProviderHealthOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxCooldownMs = options.maxCooldownMs ?? MAX_COOLDOWN_MS;
    this.modelTtlMs = options.modelUnavailableTtlMs ?? MODEL_UNAVAILABLE_TTL_MS;
  }

  /**
   * Record a failed provider attempt. Request-level failures are ignored
   * (the provider is not at fault); model-level failures mark the *model*
   * unavailable for a while instead of cooling down the whole provider.
   */
  recordFailure(provider: string, outcome: HealthOutcome, modelId = ""): void {
    if (REQUEST_LEVEL_CODES.has(outcome.code)) return;

    if (MODEL_LEVEL_CODES.has(outcome.code)) {
      this.markModelUnavailable(modelId, this.modelTtlMs);
      return;
    }

    this.failureCount++;
    const consecutive = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, consecutive);

    const base = COOLDOWN_BASE_MS[outcome.code] ?? DEFAULT_COOLDOWN_BASE_MS;
    const scaled = base * 2 ** (consecutive - 1);
    const cooldown = Math.min(scaled, this.maxCooldownMs);
    const until = this.now() + cooldown;
    const current = this.cooldownUntil.get(provider) ?? 0;
    // Never shorten an existing cooldown.
    if (until > current) this.cooldownUntil.set(provider, until);
    this.cooldownCount++;
  }

  /** Record a successful stream open — clears failures and any cooldown. */
  recordSuccess(provider: string): void {
    this.successCount++;
    this.failures.delete(provider);
    this.cooldownUntil.delete(provider);
  }

  /** true when the provider is not currently cooling down. */
  isHealthy(provider: string): boolean {
    return this.cooldownRemainingMs(provider) <= 0;
  }

  /** Milliseconds until the provider may be tried again (0 = healthy). */
  cooldownRemainingMs(provider: string): number {
    const until = this.cooldownUntil.get(provider);
    if (until === undefined) return 0;
    const remaining = until - this.now();
    if (remaining <= 0) {
      // Lazy expiry: recovery resets the streak so backoff restarts fresh.
      this.cooldownUntil.delete(provider);
      this.failures.delete(provider);
      return 0;
    }
    return remaining;
  }

  /**
   * Mark a catalog id as unavailable (e.g. the provider returned
   * `model_not_found`). Routing skips it until the TTL expires — this is how
   * a static catalog stays safe when a provider retires a model.
   */
  markModelUnavailable(modelId: string, ttlMs = this.modelTtlMs): void {
    if (!modelId) return;
    this.unavailableModels.set(modelId, this.now() + Math.max(1_000, ttlMs));
  }

  /** Remove an explicit block early (operator / after a catalog refresh). */
  markModelAvailable(modelId: string): void {
    this.unavailableModels.delete(modelId);
  }

  isModelAvailable(modelId: string): boolean {
    const until = this.unavailableModels.get(modelId);
    if (until === undefined) return true;
    if (this.now() >= until) {
      this.unavailableModels.delete(modelId);
      return true;
    }
    return false;
  }

  /** Counts and remaining durations only — safe for admin/debug metrics. */
  snapshot(): {
    providers: ProviderHealthSnapshot[];
    unavailableModels: ModelAvailabilitySnapshot[];
    totals: { success: number; failure: number; cooldowns: number };
  } {
    const providers = [...new Set([...this.failures.keys(), ...this.cooldownUntil.keys()])]
      .sort()
      .map(provider => ({
        provider,
        consecutiveFailures: this.failures.get(provider) ?? 0,
        cooldownRemainingMs: this.cooldownRemainingMs(provider),
      }));
    const unavailableModels = [...this.unavailableModels.entries()]
      .map(([modelId, until]) => ({ modelId, remainingMs: Math.max(0, until - this.now()) }))
      .filter(entry => entry.remainingMs > 0)
      .sort((a, b) => a.modelId.localeCompare(b.modelId));
    return {
      providers,
      unavailableModels,
      totals: { success: this.successCount, failure: this.failureCount, cooldowns: this.cooldownCount },
    };
  }

  reset(): void {
    this.failures.clear();
    this.cooldownUntil.clear();
    this.unavailableModels.clear();
    this.successCount = 0;
    this.failureCount = 0;
    this.cooldownCount = 0;
  }
}

/**
 * Shared instance for the chat Edge Function isolate. Module state survives
 * across requests inside one isolate, which is exactly the scope we want for
 * cooldowns (best-effort across isolates, never a hard distributed lock).
 */
export const chatProviderHealth = new ProviderHealth();
