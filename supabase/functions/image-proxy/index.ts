import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_HOSTS = new Set(["gstatic.com", "googleusercontent.com"]);
const MAX_BYTES = 5 * 1024 * 1024;
function isAllowedHost(hostname: string) { const host = hostname.toLowerCase().replace(/\.$/, ""); return [...ALLOWED_HOSTS].some(base => host === base || host.endsWith(`.${base}`)); }
function cors(req: Request): HeadersInit { return { "Access-Control-Allow-Origin": req.headers.get("Origin") || "*", "Vary": "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable" }; }
function log(requestId: string, event: string, fields: Record<string, unknown> = {}) { console.log(JSON.stringify({ at: new Date().toISOString(), fn: "image-proxy", request_id: requestId, event, ...fields })); }
Deno.serve(async req => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { ...cors(req), "X-Request-Id": requestId } });
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return new Response("Missing image URL", { status: 400, headers: { ...cors(req), "X-Request-Id": requestId } });
  let target: URL;
  try { target = new URL(raw); } catch { return new Response("Invalid image URL", { status: 400, headers: { ...cors(req), "X-Request-Id": requestId } }); }
  log(requestId, "request", { host: target.hostname, protocol: target.protocol });
  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) { log(requestId, "rejected_host", { host: target.hostname }); return new Response("Image host not allowed", { status: 403, headers: { ...cors(req), "X-Request-Id": requestId } }); }
  try {
    const upstream = await fetch(target.href, { headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.8,*/*;q=0.5" }, redirect: "manual" });
    const contentType = upstream.headers.get("content-type") || "";
    log(requestId, "upstream_response", { status: upstream.status, content_type: contentType.split(";")[0] || "" });
    if (upstream.status >= 300 && upstream.status < 400) { log(requestId, "upstream_redirect_rejected", {}); return new Response("Image redirect not allowed", { status: 502, headers: { ...cors(req), "X-Request-Id": requestId } }); }
    if (!upstream.ok || !upstream.body) return new Response("Image unavailable", { status: 502, headers: { ...cors(req), "X-Request-Id": requestId } });
    if (!contentType.toLowerCase().startsWith("image/")) return new Response("Upstream is not an image", { status: 415, headers: { ...cors(req), "X-Request-Id": requestId } });
    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) return new Response("Image too large", { status: 413, headers: { ...cors(req), "X-Request-Id": requestId } });
    const reader = upstream.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); return new Response("Image too large", { status: 413, headers: { ...cors(req), "X-Request-Id": requestId } }); } chunks.push(value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    log(requestId, "success", { bytes: total, content_type: contentType.split(";")[0] });
    return new Response(bytes, { headers: { ...cors(req), "Content-Type": contentType.split(";")[0], "Content-Length": String(bytes.byteLength), "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } });
  } catch (error) { log(requestId, "fetch_failed", { error: error instanceof Error ? error.name : "unknown" }); return new Response("Image fetch failed", { status: 502, headers: { ...cors(req), "X-Request-Id": requestId } }); }
});
