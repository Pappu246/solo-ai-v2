/**
 * Image Search Provider Layer
 *
 * Google Custom Search image provider. Credentials stay server-side and all
 * result normalization is dependency-injected for deterministic tests.
 */

export interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  sourceUrl: string;
  sourceName: string;
  width?: number;
  height?: number;
}

export interface ImageSearchProvider {
  search(query: string): Promise<ImageResult[]>;
  readonly name: string;
}

export type EnvReader = (name: string) => string | undefined;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleCSEConfig {
  apiKey: string;
  engineId: string;
}

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
      imgSize: "medium",
    });
    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
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
    if (!Array.isArray(data.items)) return [];
    const results: ImageResult[] = [];
    const seenUrls = new Set<string>();

    for (const item of data.items) {
      if (!item.link || !item.image?.thumbnailLink || !item.title) continue;
      if (seenUrls.has(item.link)) continue;
      seenUrls.add(item.link);

      const width = item.image.width ? parseInt(String(item.image.width), 10) : 0;
      const height = item.image.height ? parseInt(String(item.image.height), 10) : 0;
      if (width > 0 && height > 0 && (width < 200 || height < 200)) continue;

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
      if (results.length >= 8) break;
    }
    return results;
  }

  private extractDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return "unknown"; }
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

export function createImageSearchProvider(env: EnvReader, fetchImpl: FetchLike = fetch): ImageSearchProvider | null {
  const apiKey = env("GOOGLE_CSE_API_KEY")?.trim();
  const engineId = env("GOOGLE_CSE_ENGINE_ID")?.trim();
  if (!apiKey || !engineId) {
    console.warn("[image-search] Google CSE not configured (missing GOOGLE_CSE_API_KEY or GOOGLE_CSE_ENGINE_ID)");
    return null;
  }
  return new GoogleCSEProvider({ apiKey, engineId }, fetchImpl);
}

export function filterResults(results: ImageResult[]): ImageResult[] {
  const seen = new Set<string>();
  const filtered: ImageResult[] = [];
  for (const result of results) {
    if (!result.url || !result.thumbnail || !result.title) continue;
    try {
      const imageUrl = new URL(result.url);
      const thumbnailUrl = new URL(result.thumbnail);
      if (!["http:", "https:"].includes(imageUrl.protocol) || !["http:", "https:"].includes(thumbnailUrl.protocol)) continue;
    } catch { continue; }
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    if (result.width && result.height && (result.width < 200 || result.height < 200)) continue;
    filtered.push(result);
  }
  return filtered;
}

export function redactImageSearchSecrets(text: string, secrets: Array<string | undefined> = []): string {
  let out = text ?? "";
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  return out.replace(/\bAIza[0-9A-Za-z_-]{10,}/g, "[redacted]");
}
