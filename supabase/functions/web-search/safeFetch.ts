/**
 * Safe outbound HTTP for web research (Phase 5).
 *
 * Protections:
 *  - scheme allow-list (http/https only, no credentials, standard ports)
 *  - literal-IP and hostname block-lists for private / loopback / link-local /
 *    CGNAT / cloud-metadata ranges (IPv4 + IPv6)
 *  - best-effort DNS re-validation of hostnames (resolver is injected so the
 *    offline tests are deterministic; runtimes without DNS permission fall
 *    back to the hostname/IP checks)
 *  - manual redirect following with re-validation of every hop
 *  - response size cap, content-type allow-list, timeout
 *  - conservative HTML → text extraction (scripts/styles stripped, entities
 *    decoded, output truncated)
 *
 * This module never fetches from the internal network and never executes
 * fetched content.
 */

export const MAX_FETCH_BYTES = 512_000;
export const MAX_TEXT_CHARS = 4_000;
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/** Returns resolved IPs for a hostname; empty array = could not resolve. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

// ── URL validation ──────────────────────────────────────────────────────────

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(`unsafe url: ${reason}`);
    this.name = "UnsafeUrlError";
  }
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(p => Number(p));
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!addr.includes(":")) return isPrivateIpv4(addr);
  if (addr === "::1" || addr === "::") return true;
  if (addr.startsWith("::ffff:")) {
    const mapped = addr.slice("::ffff:".length);
    return mapped.includes(".") ? isPrivateIpv4(mapped) : false;
  }
  const head = addr.split(":")[0] ?? "";
  const headNum = Number.parseInt(head, 16);
  if (Number.isNaN(headNum)) return true; // unparseable → treat as unsafe
  if (headNum >= 0xfc00 && headNum <= 0xfdff) return true; // unique local fc00::/7
  if (headNum >= 0xfe80 && headNum <= 0xfebf) return true; // link-local fe80::/10
  if (headNum >= 0xff00) return true; // multicast
  return false;
}

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".home"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal", "ip6-localhost", "ip6-loopback"]);

function assertSafeHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("empty host");
  if (BLOCKED_HOSTS.has(host)) throw new UnsafeUrlError(`blocked host ${host}`);
  if (BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) throw new UnsafeUrlError(`blocked host suffix ${host}`);
  if (IPV4_LITERAL.test(host) && isPrivateIpv4(host)) throw new UnsafeUrlError(`private address ${host}`);
  if (host.startsWith("[") || host.includes(":")) {
    if (isPrivateIpv6(host)) throw new UnsafeUrlError(`private address ${host}`);
  }
}

const defaultResolver: DnsResolver = async hostname => {
  try {
    const records = await Deno.resolveDns(hostname, "A");
    return records ?? [];
  } catch {
    return [];
  }
};

/**
 * Validate a URL for outbound fetching. Throws `UnsafeUrlError` for anything
 * that is not a public http(s) endpoint on a standard port.
 */
export async function validatePublicHttpUrl(raw: string, resolveDns: DnsResolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError(`scheme ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError("credentials in URL");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError(`port ${url.port}`);

  assertSafeHostname(url.hostname);

  // Best-effort DNS re-validation for hostnames (skipped for literals).
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!IPV4_LITERAL.test(host) && !host.includes(":")) {
    const addresses = await resolveDns(host);
    for (const address of addresses) {
      if (isPrivateIpv4(address) || isPrivateIpv6(address)) {
        throw new UnsafeUrlError(`resolves to private address ${address}`);
      }
    }
  }
  return url;
}

// ── Safe fetch ──────────────────────────────────────────────────────────────

export interface FetchSourceResult {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  title: string;
  text: string;
  truncated: boolean;
}

const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

async function readCappedBody(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes: out, truncated };
}

/**
 * Fetch a public URL and return bounded, extracted plain text.
 * Redirects are followed manually (each hop re-validated), the body is
 * capped, and only text-ish content types are accepted.
 */
export async function fetchSource(
  rawUrl: string,
  options: {
    fetchImpl?: FetchLike;
    resolveDns?: DnsResolver;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<FetchSourceResult> {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_FETCH_BYTES;
  const resolveDns = options.resolveDns ?? defaultResolver;

  let current = await validatePublicHttpUrl(rawUrl, resolveDns);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetchImpl(current.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.1" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new UnsafeUrlError("redirect without location");
        try { await response.body?.cancel(); } catch { /* ignore */ }
        if (hop === MAX_REDIRECTS) throw new UnsafeUrlError("too many redirects");
        current = await validatePublicHttpUrl(new URL(location, current).href, resolveDns);
        continue;
      }
      if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
      if (!response.body) throw new Error("empty response body");

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const kind = ALLOWED_CONTENT_TYPES.find(t => contentType.includes(t));
      if (!kind) {
        try { await response.body.cancel(); } catch { /* ignore */ }
        throw new UnsafeUrlError(`content-type ${contentType.split(";")[0] || "unknown"}`);
      }

      const { bytes, truncated } = await readCappedBody(response.body, maxBytes);
      const raw = new TextDecoder().decode(bytes);
      const isHtml = kind !== "text/plain";
      const title = isHtml ? extractTitle(raw) : "";
      const text = isHtml ? stripHtml(raw, MAX_TEXT_CHARS) : collapseWhitespace(raw).slice(0, MAX_TEXT_CHARS);
      const textTruncated = truncated || (isHtml ? stripHtml(raw).length > MAX_TEXT_CHARS : raw.length > MAX_TEXT_CHARS);
      return { requestedUrl: rawUrl, finalUrl: current.href, contentType: kind, title, text, truncated: textTruncated };
    }
    throw new UnsafeUrlError("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

// ── HTML / text extraction ──────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function stripHtml(html: string, limit = Number.POSITIVE_INFINITY): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ");
  const withoutTags = withoutBlocks.replace(/<[^>]*>/g, " ");
  return collapseWhitespace(decodeEntities(withoutTags)).slice(0, limit);
}

/** Strip tags from an HTML fragment (snippets, titles) with a hard cap. */
export function stripHtmlFragment(html: string, limit = 300): string {
  return stripHtml(html, limit);
}

export function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? stripHtml(match[1], 200) : "";
}
