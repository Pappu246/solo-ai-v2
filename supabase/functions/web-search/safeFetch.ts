/**
 * Safe outbound HTTP for web research (Phase 5).
 *
 * Protections:
 *  - scheme allow-list (http/https only, no credentials, standard ports)
 *  - literal-IP and hostname block-lists for private / loopback / link-local /
 *    CGNAT / cloud-metadata ranges (IPv4 + IPv6)
 *  - normalisation of unusual IP representations: decimal/hex/octal IPv4
 *    (`http://2130706433/` = 127.0.0.1), dotted- and hex-form IPv4-mapped IPv6
 *    (`[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `[:ffff:7f00:0001]`)
 *  - DNS re-validation of hostnames that is FAIL-CLOSED: a resolver that
 *    errors or returns no usable addresses denies the URL instead of being
 *    treated as proof of safety (the runtime cannot pin a hostname to a
 *    checked address at the fetch boundary, so we never claim rebinding is
 *    fully prevented — see `fetchSource`)
 *  - manual redirect following with re-validation of every hop
 *  - response size cap, content-type allow-list, timeout
 *  - conservative HTML → text extraction (scripts/styles stripped, entities
 *    decoded, output truncated)
 *
 * This module never fetches from the internal network and never executes
 * fetched content. `fetchSource` reports a `dnsRebindUnpinned` flag whenever
 * a hostname (not a literal IP) was fetched, so callers surface the residual
 * TOCTOU risk honestly rather than implying a guarantee the runtime cannot
 * provide.
 */

export const MAX_FETCH_BYTES = 512_000;
export const MAX_TEXT_CHARS = 4_000;
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * Returns resolved IPs for a hostname. An empty array or a thrown error both
 * mean “resolution failed / no usable address” — which callers must treat as
 * UNSAFE (fail-closed), never as “assume it is public”.
 */
export type DnsResolver = (hostname: string) => Promise<string[]>;

// ── URL validation ──────────────────────────────────────────────────────────

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(`unsafe url: ${reason}`);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Normalise an IPv4 in any accepted representation (dotted-decimal,
 * dotted-hex/octal/decimal, or a bare 32-bit number) to canonical
 * `a.b.c.d`. Returns null when `value` is not a valid IPv4 literal.
 *
 * `new URL` already decodes hex/octal/decimal IPv4 host forms for us, but
 * this parser is applied to raw DNS answers and literal checks too, so it
 * handles those forms explicitly and never accepts an out-of-range octet.
 */
export function normalizeIpv4(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length === 1) {
    // A single 32-bit unsigned number: decimal, 0x-hex or 0o-octal.
    const chunk = parts[0] ?? "";
    let digits = chunk;
    let base = 10;
    if (chunk.startsWith("0x")) { base = 16; digits = chunk.slice(2); }
    else if (chunk.startsWith("0o")) { base = 8; digits = chunk.slice(2); }
    if (!digits || !/^[0-9a-f]+$/.test(digits)) return null;
    const n = Number.parseInt(digits, base);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const chunk = part.trim();
    if (!chunk) return null;
    let base = 10;
    let digits = chunk;
    if (chunk.startsWith("0x")) { base = 16; digits = chunk.slice(2); }
    else if (chunk.startsWith("0o")) { base = 8; digits = chunk.slice(2); }
    else if (/^0[0-7]+$/.test(chunk)) { base = 8; digits = chunk.slice(1); }
    else if (/^0[0-9]+$/.test(chunk)) return null; // no bare leading-zero decimals
    if (!digits || !new RegExp(`^[0-9a-f]{1,${base === 16 ? 4 : base === 8 ? 11 : 3}}$`).test(digits)) return null;
    const n = Number.parseInt(digits, base);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return nums.join(".");
}

/** True when the canonical dotted-quad IPv4 is private/internal. */
export function isPrivateIpv4(ip: string): boolean {
  const canonical = normalizeIpv4(ip);
  if (!canonical) return false; // not an IPv4 literal → caller must handle it separately
  const [a, b] = canonical.split(".").map(Number);
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

/**
 * Expand an IPv6 literal into its 8 hextets. Handles `::` compression and a
 * trailing embedded IPv4 (`::ffff:127.0.0.1`, `::ffff:7f00:1`). Returns null
 * when `value` is not a valid IPv6 literal.
 */
export function parseIpv6(value: string): number[] | null {
  const addr = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!addr.includes(":")) return null;
  // Split off a trailing embedded IPv4 and convert it to two hextets.
  let tailHextets: number[] | null = null;
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const canonical = normalizeIpv4(tail);
    if (!canonical) return null;
    const [a, b, c, d] = canonical.split(".").map(Number);
    tailHextets = [(a << 8) | b, (c << 8) | d];
  } else if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail) && /:(ffff|0):$/.test(addr.slice(0, lastColon + 1))) {
    // Two hex hextets standing in for an embedded IPv4 (e.g. `::ffff:7f00:1`).
    // Only valid for mapped/compat prefixes; a plain address must not have 9 hextets.
    tailHextets = tail.split(":").map(h => Number.parseInt(h, 16));
  }
  const body = tailHextets ? addr.slice(0, lastColon + 1) : addr;
  // Strip a trailing single colon left behind by an embedded IPv4
  // (`::ffff:127.0.0.1` → `::ffff:`); real `::` compression already split off.
  const normalizedBody = tailHextets && body.endsWith(":") && !body.endsWith("::") ? body.slice(0, -1) : body;
  const [head, ...rest] = normalizedBody.split("::");
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const out: number[] = [];
    for (const h of side.split(":")) {
      if (h === "") return null; // stray "::" fragments or leading colon
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(Number.parseInt(h, 16));
    }
    return out;
  };
  let headPart: number[] | null;
  let midPart: number[] | null = [];
  if (rest.length === 0) {
    headPart = parseSide(head);
  } else {
    if (rest.length > 1) return null; // more than one "::"
    headPart = parseSide(head);
    midPart = parseSide(rest[0] ?? "");
  }
  if (headPart === null || midPart === null) return null;
  const explicit = [...headPart, ...midPart, ...(tailHextets ?? [])];
  if (rest.length === 0) {
    return explicit.length === 8 ? explicit : null;
  }
  if (explicit.length > 7) return null; // "::" must stand for ≥1 zero hextet
  const zeros = new Array<number>(8 - explicit.length).fill(0);
  return [...headPart, ...zeros, ...midPart, ...(tailHextets ?? [])];
}

/**
 * True when an IPv6 literal is loopback, unspecified, unique-local,
 * link-local, multicast, or an IPv4-mapped/compat/NAT64 form whose embedded
 * IPv4 is itself private. Any unparseable address counts as unsafe.
 */
export function isPrivateIpv6(ip: string): boolean {
  const hextets = parseIpv6(ip);
  if (!hextets) return true; // unparseable → treat as unsafe
  if (hextets.length !== 8) return true;
  const allZero = hextets.every(h => h === 0);
  if (allZero) return true; // :: (unspecified)
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 === 1) return true; // ::1
  // IPv4-mapped ::ffff:0:0/96, IPv4-compatible ::/96 and NAT64 64:ff9b::/96.
  const isV4Mapped = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff;
  const isV4Compat = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && !(h6 === 0 && h7 <= 1);
  const isNat64 = h0 === 0x64 && h1 === 0xff9b;
  if (isV4Mapped || isV4Compat || isNat64) {
    const dotted = [(h6 >> 8) & 0xff, h6 & 0xff, (h7 >> 8) & 0xff, h7 & 0xff].join(".");
    return isPrivateIpv4(dotted);
  }
  if (h0 >= 0xfc00 && h0 <= 0xfdff) return true; // unique local fc00::/7
  if (h0 >= 0xfe80 && h0 <= 0xfebf) return true; // link-local fe80::/10
  if (h0 >= 0xff00) return true; // multicast ff00::/8
  return false;
}

/** True when any IP-literal form (IPv4 or IPv6) is private/internal. */
export function isPrivateIpLiteral(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = normalizeIpv4(host);
  if (v4) return isPrivateIpv4(v4);
  if (host.includes(":")) return isPrivateIpv6(host);
  return false;
}

const IPV4_SHAPE = /^\d{1,3}(?:\.{1,3}\d{1,3}){0,3}$/;
/** Any all-numeric host is treated as an IPv4-ish literal and classified. */
const NUMERIC_HOST = /^[0-9.]+$/;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".home"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal", "ip6-localhost", "ip6-loopback"]);

function assertSafeHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("empty host");
  if (BLOCKED_HOSTS.has(host)) throw new UnsafeUrlError(`blocked host ${host}`);
  if (BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) throw new UnsafeUrlError(`blocked host suffix ${host}`);
  // Bracketed / colon-bearing hosts are IPv6 literals.
  if (host.startsWith("[") || host.includes(":")) {
    if (isPrivateIpv6(host)) throw new UnsafeUrlError(`private address ${host}`);
    return;
  }
  // Numeric hosts (decimal, hex, octal, single-number) are IPv4 literals.
  if (NUMERIC_HOST.test(host)) {
    const canonical = normalizeIpv4(host);
    if (!canonical) throw new UnsafeUrlError(`unparseable address ${host}`);
    if (isPrivateIpv4(canonical)) throw new UnsafeUrlError(`private address ${host}`);
    return;
  }
  if (IPV4_SHAPE.test(host) && isPrivateIpv4(host)) throw new UnsafeUrlError(`private address ${host}`);
}

/**
 * The real resolver. Deno's `resolveDns` answers one record type at a time;
 * a failure (NXDOMAIN, no permission, network error) is re-thrown so the
 * caller can fail closed instead of mistaking it for a clean resolution.
 */
const defaultResolver: DnsResolver = async hostname => {
  const answers: string[] = [];
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const records = await Deno.resolveDns(hostname, recordType);
      if (Array.isArray(records)) answers.push(...records);
    } catch {
      // A missing record type is fine; a total failure is handled by the
      // empty-answers check in validatePublicHttpUrl.
    }
  }
  return answers;
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

  // DNS re-validation for hostnames (skipped for literals, already classified
  // above). FAIL-CLOSED: a resolver error or an empty/unusable answer set is
  // treated as unsafe — never as proof that the host is public.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLiteral = host.startsWith("[") || host.includes(":") || NUMERIC_HOST.test(host);
  if (!isLiteral) {
    let addresses: string[];
    try {
      addresses = await resolveDns(host);
    } catch {
      throw new UnsafeUrlError(`dns resolution failed for ${host}`);
    }
    if (!addresses || addresses.length === 0) {
      throw new UnsafeUrlError(`no usable dns answer for ${host}`);
    }
    let usable = 0;
    for (const address of addresses) {
      if (isPrivateIpLiteral(address)) {
        throw new UnsafeUrlError(`resolves to private address ${address}`);
      }
      // Only count addresses we could positively classify as public.
      if (normalizeIpv4(address) || parseIpv6(address)) usable++;
    }
    if (usable === 0) throw new UnsafeUrlError(`no usable dns answer for ${host}`);
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
  /**
   * True when a hostname (not a literal IP) was fetched. The runtime checks
   * the address but fetches by name, so a TOCTOU/DNS-rebinding window the
   * runtime cannot close remains — callers must surface this honestly.
   */
  dnsRebindUnpinned: boolean;
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
  const fetchUnpinned = isHostnameTarget(current);
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
      return { requestedUrl: rawUrl, finalUrl: current.href, contentType: kind, title, text, truncated: textTruncated, dnsRebindUnpinned: fetchUnpinned };
    }
    throw new UnsafeUrlError("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

/** True when the URL targets a hostname (not an IP literal). */
function isHostnameTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return !host.startsWith("[") && !host.includes(":") && !NUMERIC_HOST.test(host);
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
    .replace(/<!--[\s\S]*?--!?>/g, " ")
    .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript[^>]*>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg[^>]*>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template[^>]*>/gi, " ");
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
