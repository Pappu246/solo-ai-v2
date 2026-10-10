/**
 * Web research providers (Phase 5) — a SEPARATE abstraction from Smart Image
 * Search. Free-first:
 *
 *  1. Google Custom Search (web mode) — used when the existing
 *     `GOOGLE_CSE_API_KEY` / `GOOGLE_CSE_ENGINE_ID` secrets are present
 *     (same credentials as image search; no new setup).
 *  2. DuckDuckGo HTML — keyless fallback so research works with zero
 *     configuration.
 *  3. `null` when `WEB_SEARCH_PROVIDER=off` or nothing can run — the chat
 *     function then degrades to a normal answer instead of faking sources.
 *
 * Everything is dependency-injected (`env`, `fetchImpl`) so the offline test
 * suite is deterministic and never touches the network.
 */

import { stripHtmlFragment, type FetchLike } from "./safeFetch.ts";

export type EnvReader = (name: string) => string | undefined;

export interface WebSearchSource {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  rank: number;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, limit?: number): Promise<WebSearchSource[]>;
}

// ── URL / source helpers ────────────────────────────────────────────────────

/** Hostname without the `www.` prefix; empty string when unparseable. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Canonical http(s) URL or null (fragments stripped, length-capped). */
export function normalizeWebUrl(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed.length > 2_000) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Deduplicate by canonical URL, cap per domain (source diversity), keep the
 * best-ranked copy and re-rank 1..n for citation markers.
 */
export function normalizeSources(
  sources: WebSearchSource[],
  options: { max?: number; maxPerDomain?: number } = {},
): WebSearchSource[] {
  const max = options.max ?? 6;
  const maxPerDomain = options.maxPerDomain ?? 2;

  const seenUrls = new Set<string>();
  const perDomain = new Map<string, number>();
  const kept: WebSearchSource[] = [];

  for (const source of [...sources].sort((a, b) => a.rank - b.rank)) {
    const url = normalizeWebUrl(source.url);
    if (!url || seenUrls.has(url)) continue;
    const domain = domainOf(url) || source.domain;
    if (!domain) continue;
    const count = perDomain.get(domain) ?? 0;
    if (count >= maxPerDomain) continue;
    if (!source.title) continue;
    seenUrls.add(url);
    perDomain.set(domain, count + 1);
    kept.push({ ...source, url, domain, snippet: source.snippet?.slice(0, 400) });
    if (kept.length >= max) break;
  }
  return kept.map((source, index) => ({ ...source, rank: index + 1 }));
}

// ── Providers ───────────────────────────────────────────────────────────────

/** Google Custom Search JSON API in web (non-image) mode. */
export class GoogleCseWebProvider implements WebSearchProvider {
  readonly name = "google-cse-web";

  constructor(
    private readonly config: { apiKey: string; engineId: string },
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async search(query: string, limit = 6): Promise<WebSearchSource[]> {
    const params = new URLSearchParams({
      key: this.config.apiKey,
      cx: this.config.engineId,
      q: query,
      num: String(Math.min(Math.max(limit, 1), 10)),
    });
    const response = await this.fetchImpl(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`google cse HTTP ${response.status}`);
    const data = await response.json() as { items?: Array<{ title?: string; link?: string; snippet?: string; displayLink?: string }> };
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((item, index) => {
      const url = normalizeWebUrl(String(item.link ?? "")) ?? "";
      return {
        title: stripHtmlFragment(String(item.title ?? ""), 200),
        url,
        domain: domainOf(url),
        snippet: stripHtmlFragment(String(item.snippet ?? ""), 400),
        rank: index + 1,
      };
    }).filter(source => source.url && source.title);
  }
}

/** Keyless DuckDuckGo HTML endpoint — the zero-config free path. */
export class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = "duckduckgo-html";

  constructor(private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {}

  async search(query: string, limit = 6): Promise<WebSearchSource[]> {
    const response = await this.fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "text/html" },
    });
    if (!response.ok) throw new Error(`duckduckgo HTTP ${response.status}`);
    // The results page is bounded; cap before parsing regardless.
    const html = (await response.text()).slice(0, 400_000);

    const titles = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];

    const sources: WebSearchSource[] = [];
    for (let i = 0; i < titles.length && sources.length < limit; i++) {
      const href = decodeDdgHref(titles[i][1]);
      const url = normalizeWebUrl(href);
      if (!url) continue;
      const title = stripHtmlFragment(titles[i][2], 200);
      if (!title) continue;
      const snippet = snippets[i] ? stripHtmlFragment(snippets[i][1], 400) : undefined;
      sources.push({ title, url, domain: domainOf(url), ...(snippet ? { snippet } : {}), rank: sources.length + 1 });
    }
    return sources;
  }
}

/** DuckDuckGo wraps result links in `//duckduckgo.com/l/?uddg=<encoded>`. */
export function decodeDdgHref(href: string): string {
  const trimmed = (href || "").trim();
  if (!trimmed) return "";
  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  try {
    const url = new URL(absolute, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    if (target) return target;
  } catch { /* fall through */ }
  return absolute;
}

/**
 * Pick the provider for this deployment:
 * `WEB_SEARCH_PROVIDER=off` → null (explicitly disabled);
 * CSE secrets present → Google CSE web; otherwise the keyless DDG path.
 */
export function createWebSearchProvider(env: EnvReader, fetchImpl?: FetchLike): WebSearchProvider | null {
  const mode = (env("WEB_SEARCH_PROVIDER") || "").trim().toLowerCase();
  if (mode === "off" || mode === "disabled" || mode === "false") return null;
  if (mode === "duckduckgo") return new DuckDuckGoProvider(fetchImpl);

  const apiKey = env("GOOGLE_CSE_API_KEY")?.trim();
  const engineId = env("GOOGLE_CSE_ENGINE_ID")?.trim();
  if (apiKey && engineId && mode !== "duckduckgo") {
    return new GoogleCseWebProvider({ apiKey, engineId }, fetchImpl);
  }
  // Free-first default: no keys required.
  if (mode === "google" || mode === "cse") return null; // explicitly asked for CSE but unconfigured
  return new DuckDuckGoProvider(fetchImpl);
}

// ── Research decision ───────────────────────────────────────────────────────

const RESEARCH_PATTERNS: RegExp[] = [
  /\b(search( the)? web|web search|search online|look (it |this )?up online|online (search|research))\b/i,
  /\b(find|get|show me|fetch)\s+(me\s+)?(the\s+)?(latest|most recent|current)\b/i,
  /\b(latest|recent|breaking|today'?s|current|upcoming)\s+(news|headlines?|updates?|versions?|releases?|prices|pricing|developments?|events|trends?)\b/i,
  /\b(news|updates?|releases?)\s+(about|on|for)\s+/i,
  /\bas of (today|now|this (week|month|year)|20\d\d)\b/i,
  /\b(give|provide|list|cite|with|include)\s+(me\s+)?(your\s+)?(sources|citations|references)\b/i,
  /\baccording to (the )?(web|news|recent reports?|press)\b/i,
  /\bwhat'?s (new|happening|trending) (with|about|in)\b/i,
  /\bcompare\s+.{0,60}\b(sources|with citations)\b/i,
];

/**
 * Conservative heuristic: true only for explicit web-research phrasing.
 * The client may also set `research: true` to force it; either way an
 * unavailable provider degrades to a normal answer (never fake sources).
 */
export function shouldResearch(message: string): boolean {
  const text = message.trim();
  if (text.length < 8 || text.length > 2_000) return false;
  return RESEARCH_PATTERNS.some(pattern => pattern.test(text));
}

// ── Prompt block for the model ──────────────────────────────────────────────

/** Numbered source block appended to the system prompt when research ran. */
export function sourcesPromptBlock(sources: WebSearchSource[]): string {
  const lines = sources.map(s => `[${s.rank}] ${s.title} (${s.domain})\n    ${s.url}${s.snippet ? `\n    Excerpt: ${s.snippet}` : ""}`);
  return [
    "",
    "",
    "### Web research sources",
    "The following live web sources were retrieved for this turn. Use them where relevant,",
    "cite them inline as [1], [2] matching the numbers below, and prefer them over memory",
    "for anything time-sensitive. If a source does not answer the question, ignore it —",
    "never invent additional URLs.",
    "",
    ...lines,
  ].join("\n");
}
