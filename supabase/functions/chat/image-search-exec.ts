import { createImageSearchProvider, filterResults, type ImageResult } from "../image-search/providers.ts";
import { imageSearchCache } from "../image-search/cache.ts";

type LogFn = (id: string, event: string, fields?: Record<string, unknown>) => void;

export async function executeImageSearch(qs: string[], id: string, log: LogFn) {
  const provider = createImageSearchProvider((n) => Deno.env.get(n));
  if (!provider) {
    log(id, "image_search_provider_unavailable");
    return { images: [], error: "Image search not configured" };
  }
  const all: ImageResult[] = [];
  let failed = 0;
  for (const q of qs.slice(0, 3)) {
    const key = `search:${q.toLowerCase().trim()}`, c = imageSearchCache.get(key);
    if (c) {
      all.push(...c.results);
      log(id, "image_search_cache_hit", { query: q, resultCount: c.results.length });
      continue;
    }
    try {
      const raw = await Promise.race([
        provider.search(q),
        new Promise<ImageResult[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      const f = filterResults(raw);
      all.push(...f);
      imageSearchCache.set(key, { query: q, results: f, timestamp: Date.now() });
      log(id, "image_search_provider_result", {
        query: q,
        rawCount: raw.length,
        filteredCount: f.length,
        thumbnailHosts: [
          ...new Set(f.map((x) => {
            try {
              return new URL(x.thumbnail).hostname;
            } catch {
              return "invalid";
            }
          })),
        ],
      });
    } catch (e) {
      failed++;
      log(id, "image_search_provider_failure", { query: q, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  const seen = new Set<string>(),
    images = all.filter((x) => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    }).slice(0, 10);
  log(id, "image_search_normalized", { count: images.length, failedQueries: failed });
  return images.length || !failed ? { images } : { images: [], error: "Image search failed" };
}
