import { describe, it, expect, vi } from 'vitest';
import { retryTransient, isTransientNetworkError } from './retry';

const noSleep = () => Promise.resolve();
/** A non-network application error (stands in for AppError/RLS failures). */
class AppLike extends Error {}

describe('isTransientNetworkError', () => {
  it('recognises browser network failures', () => {
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientNetworkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isTransientNetworkError(new Error('Network request failed'))).toBe(true);
  });

  it('treats timeouts as transient but aborts as final', () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isTransientNetworkError(timeout)).toBe(true);
    expect(isTransientNetworkError(abort)).toBe(false);
  });

  it('does not retry auth, validation or logic errors', () => {
    expect(isTransientNetworkError(new Error('Unauthorized'))).toBe(false);
    expect(isTransientNetworkError(new AppLike('row-level security'))).toBe(false);
    expect(isTransientNetworkError('not an error')).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
  });
});

describe('retryTransient', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = vi.fn(noSleep);
    const fn = vi.fn(async () => 'ok');
    await expect(retryTransient(fn, { sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient failures with backoff and eventually succeeds', async () => {
    const delays: number[] = [];
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError('Failed to fetch');
      return 'recovered';
    });
    await expect(retryTransient(fn, {
      attempts: 3,
      delayMs: 100,
      sleep: async ms => { delays.push(ms); },
    })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]); // exponential backoff
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const fn = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(retryTransient(fn, { attempts: 3, sleep: noSleep })).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a non-transient error', async () => {
    const fn = vi.fn(async () => { throw new Error('Unauthorized'); });
    await expect(retryTransient(fn, { attempts: 5, sleep: noSleep })).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours aborts immediately', async () => {
    const fn = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    await expect(retryTransient(fn, { attempts: 5, sleep: noSleep })).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clamps nonsense attempt budgets', async () => {
    const fn = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(retryTransient(fn, { attempts: 0, sleep: noSleep })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // attempts clamped up to at least 1
  });
});
