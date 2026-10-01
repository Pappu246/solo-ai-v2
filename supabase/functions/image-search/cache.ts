/**
 * Simple TTL-based cache for image search results.
 *
 * Google CSE free tier is 100 queries/day, so caching is critical.
 * We cache by normalized query key with a configurable TTL (default 30 minutes).
 *
 * This is an in-memory cache — it does not persist across cold starts,
 * but that's acceptable for a search cache (worst case: one extra API call).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheFetchResult<T> {
  value: T;
  cached: boolean;
  coalesced: boolean;
}

/**
 * Normalize cache keys so equivalent queries share cache entries:
 * case, repeated whitespace and Unicode compatibility forms are ignored.
 */
export function normalizeCacheKey(key: string): string {
  return key.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export class TTLCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs: number = 30 * 60 * 1000, maxSize: number = 200) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /** Get a cached value, or undefined if not present or expired. */
  get(key: string): T | undefined {
    const normalizedKey = normalizeCacheKey(key);
    const entry = this.cache.get(normalizedKey);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(normalizedKey);
      return undefined;
    }

    return entry.value;
  }

  /** Store a value in the cache with the configured TTL. */
  set(key: string, value: T): void {
    const normalizedKey = normalizeCacheKey(key);

    // Replace an existing entry without consuming an additional cache slot.
    if (this.cache.has(normalizedKey)) this.cache.delete(normalizedKey);

    // Evict before insertion so the cache never grows beyond maxSize.
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(normalizedKey, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Read a cached value or run one shared loader for concurrent cache misses.
   * All concurrent callers for the same normalized key await the same promise.
   */
  async getOrSet(key: string, loader: () => Promise<T>): Promise<CacheFetchResult<T>> {
    const normalizedKey = normalizeCacheKey(key);

    const cached = this.get(normalizedKey);
    if (cached !== undefined) {
      return { value: cached, cached: true, coalesced: false };
    }

    const existing = this.inFlight.get(normalizedKey);
    if (existing) {
      return { value: await existing, cached: false, coalesced: true };
    }

    const pending = Promise.resolve()
      .then(loader)
      .then(value => {
        this.set(normalizedKey, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(normalizedKey);
      });

    this.inFlight.set(normalizedKey, pending);
    return { value: await pending, cached: false, coalesced: false };
  }

  /** Check if a key is cached and not expired. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Remove a specific key. */
  delete(key: string): void {
    this.cache.delete(normalizeCacheKey(key));
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached entries currently stored. */
  get size(): number {
    return this.cache.size;
  }

  /** Evict expired entries and, if still at capacity, the entry expiring soonest. */
  private evictOldest(): void {
    const now = Date.now();

    // First pass: remove expired entries.
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    // If still at capacity, remove the entry expiring soonest.
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | undefined;
      let oldestExpiry = Number.POSITIVE_INFINITY;

      for (const [key, entry] of this.cache) {
        if (entry.expiresAt < oldestExpiry) {
          oldestExpiry = entry.expiresAt;
          oldestKey = key;
        }
      }

      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
  }
}

/** Shape of cached search results. */
export interface ImageSearchResult {
  query: string;
  results: Array<{
    url: string;
    thumbnail: string;
    title: string;
    sourceUrl: string;
    sourceName: string;
    width?: number;
    height?: number;
  }>;
  timestamp: number;
}

// Default cache instance: 30 min TTL, max 200 queries cached.
export const imageSearchCache = new TTLCache<ImageSearchResult>(
  30 * 60 * 1000,
  200,
);
