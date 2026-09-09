/**
 * Image Search Edge Function
 *
 * Standalone endpoint for searching images. Can be called directly by the
 * client or used internally by the chat function.
 *
 * Request:
 *   POST /functions/v1/image-search
 *   Authorization: Bearer <user-token>
 *   Content-Type: application/json
 *   {
 *     "queries": string[],  // 1-3 search queries
 *     "maxResults": number  // optional, default 10
 *   }
 *
 * Response:
 *   {
 *     "results": ImageResult[],
 *     "queries": string[],
 *     "cached": boolean
 *   }
 *
 * Security:
 *   - Requires valid JWT (Supabase auth)
 *   - Rate limited (10 requests/minute per user)
 *   - Google CSE API keys are server-side only (never sent to client)
 *   - Timeout: 10 seconds total
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createImageSearchProvider,
  filterResults,
  redactImageSearchSecrets,
  type EnvReader,
  type ImageResult,
} from "./providers.ts";
import { imageSearchCache, type ImageSearchResult } from "./cache.ts";

// ── CORS ────────────────────────────────────────────────────────────────────

const origins = (Deno.env.get("APP_ORIGIN") || "").split(",").map(v => v.trim()).filter(Boolean);
const cors = (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const allow = origins.length ? (origins.includes(origin) ? origin : origins[0]) : (origin || "*");
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Access-Control-Expose-Headers": "X-Request-Id",
  };
};

const json = (req: Request, body: unknown, status = 200, requestId?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", ...(requestId ? { "X-Request-Id": requestId } : {}) },
  });

// ── Auth ────────────────────────────────────────────────────────────────────

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
let publishableKey = "";
try { publishableKey = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || ""; } catch { publishableKey = ""; }
publishableKey ||= Deno.env.get("SUPABASE_ANON_KEY") || "";
const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } })
  : null;

async function requireUser(req: Request) {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ") || !authClient) throw Object.assign(new Error("Unauthorized"), { status: 401, code: "unauthorized" });
  const { data, error } = await authClient.auth.getUser(header.slice(7));
  if (error || !data.user) throw Object.assign(new Error("Unauthorized"), { status: 401, code: "unauthorized" });
  return data.user;
}

// ── Rate Limiting ───────────────────────────────────────────────────────────

const buckets = new Map<string, { at: number; count: number }>();
function rateLimit(userId: string) {
  const now = Date.now(); const b = buckets.get(userId);
  if (!b || now - b.at >= 60_000) { buckets.set(userId, { at: now, count: 1 }); return; }
  if (b.count >= 10) throw Object.assign(new Error("Rate limit exceeded. Please wait a minute."), { status: 429, code: "rate_limited" });
  b.count++;
}

// ── Logging ─────────────────────────────────────────────────────────────────

function log(requestId: string, event: string, fields: Record<string, unknown> = {}) {
  const apiKey = Deno.env.get("GOOGLE_CSE_API_KEY");
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) safe[k] = typeof v === "string" ? redactImageSearchSecrets(v, [apiKey]).slice(0, 500) : v;
  console.log(JSON.stringify({ at: new Date().toISOString(), fn: "image-search", request_id: requestId, event, ...safe }));
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const requestId = crypto.randomUUID();

  try {
    const user = await requireUser(req);
    if (req.method !== "POST") {
      return json(req, { error: "Method not allowed", code: "method_not_allowed", request_id: requestId }, 405, requestId);
    }

    rateLimit(user.id);

    // Parse request body
    const body = await req.json().catch(() => {
      throw Object.assign(new Error("Invalid JSON body"), { status: 400, code: "invalid_request" });
    });

    const queries: string[] = Array.isArray(body?.queries) ? body.queries.slice(0, 3) : [];
    if (queries.length === 0) {
      return json(req, { error: "At least one query is required", code: "invalid_request", request_id: requestId }, 400, requestId);
    }

    const maxResults = typeof body?.maxResults === "number" ? Math.min(Math.max(body.maxResults, 1), 30) : 10;

    log(requestId, "search_request", { queries: queries.length, maxResults, user_id: user.id });

    // Create provider
    const env: EnvReader = (name) => Deno.env.get(name);
    const provider = createImageSearchProvider(env);
    if (!provider) {
      return json(req, {
        error: "Image search is not configured",
        code: "image_search_not_configured",
        request_id: requestId,
      }, 503, requestId);
    }

    // Execute searches (with caching)
    const allResults: ImageResult[] = [];
    const executedQueries: string[] = [];
    let anyCached = false;

    for (const query of queries) {
      const cacheKey = `search:${query.toLowerCase().trim()}`;
      const cached = imageSearchCache.get(cacheKey);

      if (cached) {
        allResults.push(...cached.results);
        executedQueries.push(query);
        anyCached = true;
        log(requestId, "cache_hit", { query });
        continue;
      }

      // Execute search with timeout
      try {
        const results = await Promise.race([
          provider.search(query),
          new Promise<ImageResult[]>((_, reject) =>
            setTimeout(() => reject(new Error("Search timeout")), 8000)
          ),
        ]);

        const filtered = filterResults(results);
        allResults.push(...filtered);

        // Cache the results
        const cacheEntry: ImageSearchResult = {
          query,
          results: filtered,
          timestamp: Date.now(),
        };
        imageSearchCache.set(cacheKey, cacheEntry);

        executedQueries.push(query);
        log(requestId, "search_completed", { query, resultCount: filtered.length });
      } catch (error) {
        log(requestId, "search_failed", { query, error: String(error) });
        // Continue with other queries even if one fails
      }
    }

    // Deduplicate and limit results
    const seen = new Set<string>();
    const deduplicated = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    }).slice(0, maxResults);

    log(requestId, "search_response", { resultCount: deduplicated.length, cached: anyCached });

    return json(req, {
      results: deduplicated,
      queries: executedQueries,
      cached: anyCached,
    }, 200, requestId);

  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499, headers: cors(req) });
    }

    const status = Number((error as { status?: number }).status) || 500;
    const code = String((error as { code?: string }).code || (status >= 500 ? "internal_error" : "invalid_request"));
    const message = status >= 500 ? "Something went wrong on our side. Please try again." : ((error as Error).message || "The request could not be processed.");

    if (status >= 500) {
      log(requestId, "unhandled_error", { detail: String((error as Error)?.message ?? error) });
    }

    return json(req, { error: message, code, request_id: requestId }, status, requestId);
  }
});
