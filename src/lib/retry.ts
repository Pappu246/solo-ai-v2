/**
 * Phase 11: bounded retry for transient network failures.
 *
 * Only meant for *idempotent* reads (model list, conversation loads): a chat
 * POST that may have reached the server must never be auto-retried, or it
 * could double-spend usage. Everything else — auth, validation, RLS — is
 * final and passes straight through.
 */

export interface RetryOptions {
  /** Total attempts including the first (clamped to 1..5). Default 3. */
  attempts?: number;
  /** Delay before the second attempt; doubles each retry. Default 400ms. */
  delayMs?: number;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** True for errors that are worth another attempt. */
export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Aborts and validation/auth failures are intentional outcomes.
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return error.name === 'TimeoutError';
  const message = error.message.toLowerCase();
  return message.includes('failed to fetch')
    || message.includes('fetch failed')
    || message.includes('networkerror')
    || message.includes('network request failed')
    || message.includes('load failed')
    || message.includes('socket hang up');
}

/**
 * Run `fn`, retrying only on transient network failures with exponential
 * backoff. The last error is rethrown when every attempt fails.
 */
export async function retryTransient<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.min(Math.max(options.attempts ?? 3, 1), 5);
  const baseDelay = Math.max(options.delayMs ?? 400, 0);
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === attempts - 1) throw error;
      await sleep(baseDelay * 2 ** attempt);
    }
  }
  throw lastError;
}
