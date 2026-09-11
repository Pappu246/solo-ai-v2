/**
 * Controlled image thumbnail proxy for Smart Image Search.
 *
 * Browser <img> requests cannot attach the user's Supabase Authorization header,
 * so this endpoint is intentionally public. It is tightly restricted to the
 * Google thumbnail hosts emitted by Google Custom Search and never proxies an
 * arbitrary URL. This avoids exposing third-party image hotlinking/CORS issues
 * to the browser while keeping the original source attribution untouched.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_HOSTS = new Set([
  "gstatic.com",
  "googleusercontent.com",
]);
const MAX_BYTES = 5 * 1024 * 1024;

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return [...ALLOWED_HOSTS].some(base => host === base || host.endsWith(`.${base}`));
}

function cors(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
  };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors(req) });

  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return new Response("Missing image URL", { status: 400, headers: cors(req) });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Invalid image URL", { status: 400, headers: cors(req) });
  }

  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return new Response("Image host not allowed", { status: 403, headers: cors(req) });
  }

  try {
    const upstream = await fetch(target.href, {
      method: "GET",
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.8,*/*;q=0.5" },
      redirect: "follow",
    });
    if (!upstream.ok || !upstream.body) {
      return new Response("Image unavailable", { status: 502, headers: cors(req) });
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return new Response("Upstream is not an image", { status: 415, headers: cors(req) });
    }

    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) return new Response("Image too large", { status: 413, headers: cors(req) });

    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return new Response("Image too large", { status: 413, headers: cors(req) });
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors(req),
        "Content-Type": contentType.split(";")[0],
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Image fetch failed", { status: 502, headers: cors(req) });
  }
});
