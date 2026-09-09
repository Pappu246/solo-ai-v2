/**
 * Image Search Provider Layer
 *
 * Abstract interface for image search providers with a Google Custom Search
 * Engine (CSE) implementation. The provider abstraction allows swapping to
 * other services (Bing, DuckDuckGo, etc.) without touching the decision logic
 * or UI.
 *
 * Everything here is dependency-injected (fetchImpl, env) and free of remote
 * imports so it can be type-checked and unit-tested offline.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface ImageResult {
  /** Direct URL to the full-size image. */
  url: string;
  /** Thumbnail URL (smaller preview). */
  thumbnail: string;
  /** Image title or caption. */
  title: string;
  /** URL of the source page (where the image was found). */
  sourceUrl: string;
  /** Domain name of the source (e.g., "example.com"). */
  sourceName: string;
  /** Image width in pixels (if available). */
  width?: number;
  /** Image height in pixels (if available). */
  height?: number;
}

export interface ImageSearchProvider {
  /** Search for images matching the query. Returns 0+ results. */
  search(query: string): Promise<ImageResult[]>;
  /** Provider name for logging/metrics. */
  readonly name: string;
}

export type EnvReader = (name: string) => string | undefined;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── Google Custom Search Engine Provider ────────────────────────────────────

export interface GoogleCSEConfig {
  apiKey: string;
  engineId: string;
}

/**
 * Google Custom Search JSON API (image search mode).
 *
 * Docs: https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
 *
 * Free tier: 100 queries/day. Each query returns up to 10 results.
 * We request 10 results per query and filter aggressively for quality.
 */
export class GoogleCSEProvider implements ImageSearchProvider {
  readonly name = "google-cse";
  private readonly config: GoogleCSEConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: GoogleCSEConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async search(query: string): Promise<ImageResult[]> {
    const params = new URLSearchParams({
      key: this.config.apiKey,
      cx: this.config.engineId,
      q: query,
      searchType: "image",
      num: "10",
      safe: "active",
      imgType: "photo",
      imgSize: "medium",
    });

    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(8000), // 8s timeout
      });
    } catch (error) {
      // Network failure, timeout, etc.
      console.error("[GoogleCSE] fetch failed:", error);
      return [];
    }

    if (!response.ok) {
      let body = "";
      try { body = await response.text(); } catch { /* ignore */ }
      console.error(`[GoogleCSE] HTTP ${response.status}: ${body.slice(0, 200)}`);
      return [];
    }

    let data: GoogleCSEResponse;
    try {
      data = await response.json() as GoogleCSEResponse;
    } catch {
      console.error("[GoogleCSE] invalid JSON response");
      return [];
    }

    return this.parseResults(data);
  }

  private parseResults(data: GoogleCSEResponse): ImageResult[] {
    if (!data.items || !Array.isArray(data.items)) return [];

    const results: ImageResult[] = [];
    const seenUrls = new Set<string>();

    for (const item of data.items) {
      // Skip if missing required fields
      if (!item.link || !item.image?.thumbnailLink || !item.title) continue;

      // Skip duplicates
      if (seenUrls.has(item.link)) continue;
      seenUrls.add(item.link);

      // Filter out extremely low resolution images
      const width = item.image.width ? parseInt(String(item.image.width), 10) : 0;
      const height = item.image.height ? parseInt(String(item.image.height), 10) : 0;
      if (width > 0 && height > 0 && (width < 200 || height < 200)) continue;

      // Extract domain from displayLink
      const sourceName = item.displayLink || this.extractDomain(item.link);

      results.push({
        url: item.link,
        thumbnail: item.image.thumbnailLink,
        title: item.title,
        sourceUrl: item.image.contextLink || item.link,
        sourceName,
        width: width > 0 ? width : undefined,
        height: height > 0 ? height : undefined,
      });

      // Cap at 8 results per query
      if (results.length >= 8) break;
    }

    return results;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }
}

interface GoogleCSEResponse {
  items?: Array<{
    link: string;
    title: string;
    displayLink?: string;
    image: {
      thumbnailLink: string;
      contextLink?: string;
      width?: number | string;
      height?: number | string;
    };
  }>;
}

// ── Provider Factory ────────────────────────────────────────────────────────

/**
 * Create an image search provider from environment variables.
 * Returns null if the provider is not configured (missing env vars).
 */
export function createImageSearchProvider(
  env: EnvReader,
  fetchImpl: FetchLike = fetch,
): ImageSearchProvider | null {
  const apiKey = env("GOOGLE_CSE_API_KEY")?.trim();
  const engineId = env("GOOGLE_CSE_ENGINE_ID")?.trim();

  if (!apiKey || !engineId) {
    console.warn("[image-search] Google CSE not configured (missing GOOGLE_CSE_API_KEY or GOOGLE_CSE_ENGINE_ID)");
    return null;
  }

  return new GoogleCSEProvider({ apiKey, engineId }, fetchImpl);
}

// ── Result Filtering ────────────────────────────────────────────────────────

/**
 * Filter results for quality: remove broken/duplicate URLs, extremely low
 * resolution images, and results with missing required fields.
 */
export function filterResults(results: ImageResult[]): ImageResult[] {
  const seen = new Set<string>();
  const filtered: ImageResult[] = [];

  for (const result of results) {
    // Skip if missing required fields
    if (!result.url || !result.thumbnail || !result.title) continue;

    // Skip if URL looks broken (not a valid URL)
    try {
      new URL(result.url);
      new URL(result.thumbnail);
    } catch {
      continue;
    }

    // Skip duplicates
    if (seen.has(result.url)) continue;
    seen.add(result.url);

    // Skip extremely low resolution (if dimensions are known)
    if (result.width && result.height && (result.width < 200 || result.height < 200)) continue;

    filtered.push(result);
  }

  return filtered;
}

// ── Secrets Redaction ───────────────────────────────────────────────────────

/**
 * Redact API keys from logs. Google API keys start with "AIza" and are 39 chars.
 */
export function redactImageSearchSecrets(text: string, secrets: Array<string | undefined> = []): string {
  let out = text ?? "";
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  // Generic patterns
  out = out.replace(/\bAIza[0-9A-Za-z_-]{10,}/g, "[redacted]");
  return out;
}
