/**
 * Strict CORS allowlist for authenticated Edge Functions.
 *
 * APP_ORIGIN accepts a comma-separated list of exact HTTP(S) origins. When it
 * is unset/blank, allow only the known production origin and local Vite dev
 * origins; never reflect arbitrary Origin values or emit wildcard CORS.
 *
 * CORS is not an authorization check. Each protected handler must still
 * authenticate the Supabase JWT and enforce user-level access independently.
 */
export type CorsOptions = {
  allowMethods: string;
  allowHeaders: string;
  exposeHeaders?: string;
};

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://solo-ai-v2-mu.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedOrigins(configuredOrigins: string | undefined): Set<string> {
  const entries = (configuredOrigins ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  // A blank/unset setting gets a narrow, explicit fallback. A non-empty but
  // invalid setting fails closed rather than widening access unexpectedly.
  if (!entries.length) return DEFAULT_ALLOWED_ORIGINS;

  return new Set(entries.map(normalizeOrigin).filter((origin): origin is string => origin !== null));
}

export function corsHeaders(
  req: Request,
  configuredOrigins: string | undefined,
  options: CorsOptions,
): Record<string, string> {
  const origin = req.headers.get("Origin")?.trim() ?? "";
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  const allowlist = allowedOrigins(configuredOrigins);
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": options.allowMethods,
    "Access-Control-Allow-Headers": options.allowHeaders,
  };

  if (options.exposeHeaders) headers["Access-Control-Expose-Headers"] = options.exposeHeaders;
  if (normalizedOrigin && allowlist.has(normalizedOrigin)) {
    headers["Access-Control-Allow-Origin"] = normalizedOrigin;
  }

  return headers;
}

/** First configured origin (used to build links back to the app); falls back to the production origin. */
export function primaryOrigin(configuredOrigins: string | undefined): string {
  const first = (configuredOrigins ?? "").split(",").map((v) => v.trim()).filter(Boolean)[0];
  return (first ? normalizeOrigin(first) : null) ?? [...DEFAULT_ALLOWED_ORIGINS][0];
}
