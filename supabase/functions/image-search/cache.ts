/**
 * Simple TTL-based in-memory cache for image search results.
 *
 * Google CSE free tier is 100 queries/day, so caching is critical.
 * We cache by query string with a configurable TTL (default 30 minutes).
 *
 * This is an in-memory LRU cache — it does not persist across cold starts,
 * but that's acceptable for a search cache (worst case: one extra API call).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs: number = 30 * 60 * 1000, maxSize: number = 200) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /** Get a cached value, or undefined if not present or expired. */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /** Store a value in the cache with the configured TTL. */
  set(key: string, value: T): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Check if a key is cached and not expired. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Remove a specific key. */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of entries currently in the cache (including possibly expired ones). */
  get size(): number {
    return this.cache.size;
  }

  /** Evict expired entries and, if still over capacity, the oldest entries. */
  private evictOldest(): void {
    const now = Date.now();

    // First pass: remove expired entries
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    // If still over capacity, remove oldest entries
    if (this.cache.size > this.maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt);

      const toRemove = entries.length - this.maxSize;
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
  }
}

// ── Singleton Cache Instance ────────────────────────────────────────────────

/** Default cache instance: 30 min TTL, max 200 entries. */
export const imageSearchCache = new TTLCache<ImageSearchResult[]>(
  30 * 60 * 1000, // 30 minutes
  200,             // max 200 queries cached
);

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
