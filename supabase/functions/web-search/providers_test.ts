/**
 * Offline tests for web research (Phase 5): SSRF-safe fetching, provider
 * parsing, source normalization, the research heuristic and SSE events.
 * Deterministic — injected fetch/DNS, no network. Run with:
 *   deno test supabase/functions/web-search/providers_test.ts
 */
import {
  createWebSearchProvider,
  decodeDdgHref,
  domainOf,
  DuckDuckGoProvider,
  GoogleCseWebProvider,
  normalizeSources,
  normalizeWebUrl,
  shouldResearch,
  sourcesPromptBlock,
  type EnvReader,
  type WebSearchSource,
} from "./providers.ts";
import {
  fetchSource,
  isPrivateIpv4,
  isPrivateIpv6,
  normalizeIpv4,
  parseIpv6,
  stripHtml,
  UnsafeUrlError,
  validatePublicHttpUrl,
  type FetchLike,
} from "./safeFetch.ts";
import { parseWebSearchEvent, sseWebSearchEvent } from "./events.ts";

// ── assertions (hand-rolled: the suite has zero dependencies) ──────────────

class AssertionError extends Error {
  constructor(message: string) { super(message); this.name = "AssertionError"; }
}
function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message ?? "expected a truthy value");
}
function show(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  }
}
async function assertRejectsUnsafe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof UnsafeUrlError, `expected UnsafeUrlError, got ${String(error)}`);
    return;
  }
  throw new AssertionError("expected the URL to be rejected");
}

const noDns = async (): Promise<string[]> => [];
/** Resolves any hostname to a public address (positive-path fixture). */
const publicDnsAll = async (): Promise<string[]> => ["93.184.216.34"];
const publicDns = async (host: string): Promise<string[]> =>
  host === "resolves-internal.example" ? ["10.0.0.5"] : ["93.184.216.34"];

// ── SSRF validation ────────────────────────────────────────────────────────

Deno.test("ssrf: private, loopback, link-local and metadata addresses are rejected", async () => {
  const forbidden = [
    "http://127.0.0.1/",
    "http://127.0.0.1:80/admin",
    "http://10.1.2.3/",
    "http://172.16.0.9/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://224.0.0.1/",
    "http://localhost/",
    "http://localhost:3000/",
    "http://api.local/",
    "http://db.internal/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "http://user:pass@example.com/",
    "http://example.com:8080/",
    "not-a-url",
  ];
  for (const url of forbidden) {
    await assertRejectsUnsafe(() => validatePublicHttpUrl(url, noDns));
  }
});

Deno.test("ssrf: public URLs are allowed", async () => {
  for (const url of ["https://example.com/article", "http://example.org:80/x", "https://sub.domain.co.uk/a?b=c"]) {
    const parsed = await validatePublicHttpUrl(url, publicDnsAll);
    assert(parsed.href.startsWith("http"));
  }
});

Deno.test("ssrf: hostnames that resolve to a private address are rejected", async () => {
  await assertRejectsUnsafe(() => validatePublicHttpUrl("http://resolves-internal.example/", publicDns));
  // …and a public resolution passes.
  const ok = await validatePublicHttpUrl("https://example.com/", publicDns);
  assertEquals(ok.hostname, "example.com");
});

Deno.test("ssrf: private range classifier", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.100.1.1", "255.255.255.255"]) {
    assert(isPrivateIpv4(ip), `${ip} must be private`);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.0.1"]) {
    assert(!isPrivateIpv4(ip), `${ip} must be public`);
  }
});

Deno.test("ssrf: unusual IPv4 representations normalise before classification", async () => {
  // Decimal, hex and octal forms of 127.0.0.1.
  assertEquals(normalizeIpv4("2130706433"), "127.0.0.1");
  assertEquals(normalizeIpv4("0x7f.0.0.1"), "127.0.0.1");
  assertEquals(normalizeIpv4("0177.0.0.1"), "127.0.0.1");
  assertEquals(normalizeIpv4("0x7f000001"), "127.0.0.1");
  assert(isPrivateIpv4("2130706433"), "decimal 127.0.0.1 must be private");
  assert(isPrivateIpv4("0x7f000001"), "hex 127.0.0.1 must be private");
  // Public equivalents stay public.
  assertEquals(normalizeIpv4("0x08080808"), "8.8.8.8");
  assert(!isPrivateIpv4("0x08080808"), "hex 8.8.8.8 must be public");
  // Out-of-range / malformed are not IPv4.
  assertEquals(normalizeIpv4("256.1.1.1"), null);
  assertEquals(normalizeIpv4("1.2.3"), null);
  assertEquals(normalizeIpv4("08.1.1.1"), null, "bare leading-zero decimal octet is invalid");
  assertEquals(normalizeIpv4("99999999999999999999"), null);

  // URLs that embed these forms must be rejected, not silently allowed.
  for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127.1/"]) {
    await assertRejectsUnsafe(() => validatePublicHttpUrl(url, noDns));
  }
});

Deno.test("ssrf: IPv6 literals and IPv4-mapped forms are classified", async () => {
  // Parser correctness for compressed and embedded forms.
  assertEquals(parseIpv6("::1")?.length, 8);
  assertEquals(parseIpv6("::")?.every(h => h === 0), true);
  assertEquals(parseIpv6("2001:db8::1"), [0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
  assertEquals(parseIpv6("::ffff:127.0.0.1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
  assertEquals(parseIpv6("::ffff:7f00:1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
  assertEquals(parseIpv6("bad::zz"), null);

  // Private classifications.
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::169.254.169.254"]) {
    assert(isPrivateIpv6(ip), `${ip} must be private`);
  }
  // Public IPv6 and a public mapped address stay public.
  for (const ip of ["2001:db8::1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert(!isPrivateIpv6(ip), `${ip} must be public`);
  }

  // Mapped private literals in URL form must be rejected.
  for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a00:1]/", "http://[::ffff:169.254.169.254]/"]) {
    await assertRejectsUnsafe(() => validatePublicHttpUrl(url, noDns));
  }
  // A public mapped literal is allowed.
  const okMapped = await validatePublicHttpUrl("http://[::ffff:8.8.8.8]/", noDns);
  assert(okMapped.hostname.includes("::ffff"));
});

Deno.test("ssrf: DNS failure and empty answers are denied (fail-closed)", async () => {
  // The resolver throws — must be treated as unsafe, never as "assume public".
  const throwing = async (): Promise<string[]> => { throw new Error("resolver down"); };
  await assertRejectsUnsafe(() => validatePublicHttpUrl("https://example.com/", throwing));
  // The resolver returns an empty array — also unsafe.
  await assertRejectsUnsafe(() => validatePublicHttpUrl("https://example.com/", async () => []));
  // Non-IP garbage answers count as unusable → unsafe.
  await assertRejectsUnsafe(() => validatePublicHttpUrl("https://example.com/", async () => ["not-an-ip"]));
});

Deno.test("ssrf: private DNS answers are rejected, public answers allowed", async () => {
  for (const answer of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:192.168.1.1"]) {
    await assertRejectsUnsafe(() =>
      validatePublicHttpUrl("https://mixed-dns.example/", async () => ["93.184.216.34", answer]))
    ;
  }
  // A fully public answer set passes.
  const ok = await validatePublicHttpUrl("https://example.com/", async () => ["93.184.216.34", "2606:4700:4700::1111"]);
  assertEquals(ok.hostname, "example.com");
});

Deno.test("fetch: reports the unpinned-DNS (rebinding) risk flag honestly", async () => {
  const fetchImpl: FetchLike = async () => htmlResponse("<title>Host</title><p>ok</p>");
  const byHost = await fetchSource("https://example.com/x", { fetchImpl, resolveDns: async () => ["93.184.216.34"] });
  assertEquals(byHost.dnsRebindUnpinned, true, "hostname fetches cannot be pinned by the runtime");
  const byIp = await fetchSource("http://93.184.216.34/x", { fetchImpl, resolveDns: noDns });
  assertEquals(byIp.dnsRebindUnpinned, false, "literal-IP fetches need no DNS at request time");
});

// ── safe fetch ─────────────────────────────────────────────────────────────

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...init.headers }, ...init });
}

Deno.test("fetch: extracts readable text and strips active content", async () => {
  const html = `<!doctype html><html><head><title>Quarterly Report — Example</title>
    <style>.x{color:red}</style><script>alert("boom")</script></head>
    <body><nav>Ignore me</nav><h1>Quarterly Report</h1><p>Revenue &amp; growth &mdash; details.</p>
    <script>trackEverything()</script></body></html>`;
  const fetchImpl: FetchLike = async () => htmlResponse(html);
  const result = await fetchSource("https://example.com/report", { fetchImpl, resolveDns: publicDnsAll });
  assertEquals(result.title, "Quarterly Report — Example");
  assert(!result.text.includes("alert"), "script content leaked");
  assert(!result.text.includes("trackEverything"), "script content leaked");
  assert(!result.text.includes("color:red"), "style content leaked");
  assert(result.text.includes("Revenue & growth"), "entities must be decoded");
  assert(!result.text.includes("<p>"), "tags must be stripped");
  assertEquals(result.finalUrl, "https://example.com/report");
});

Deno.test("fetch: non-text content types are refused", async () => {
  const fetchImpl: FetchLike = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
  try {
    await fetchSource("https://example.com/blob", { fetchImpl, resolveDns: publicDnsAll });
    throw new AssertionError("expected a rejection");
  } catch (error) {
    assert(error instanceof UnsafeUrlError, `expected UnsafeUrlError, got ${String(error)}`);
  }
});

Deno.test("fetch: oversized bodies are capped, not buffered whole", async () => {
  const big = `<html><body>${"word ".repeat(200_000)}</body></html>`;
  const fetchImpl: FetchLike = async () => htmlResponse(big);
  const result = await fetchSource("https://example.com/big", { fetchImpl, resolveDns: publicDnsAll, maxBytes: 10_000 });
  assert(result.truncated, "must report truncation");
  assert(result.text.length <= 4_000, `extracted text must stay bounded, got ${result.text.length}`);
});

Deno.test("fetch: redirects are re-validated at every hop", async () => {
  // Hop 1 → internal target: rejected before any request is made to it.
  const evil: FetchLike = async () => new Response(null, {
    status: 302,
    headers: { Location: "http://169.254.169.254/latest/meta-data/" },
  });
  await assertRejectsUnsafe(() => fetchSource("https://example.com/start", { fetchImpl: evil, resolveDns: publicDnsAll }));

  // Hop 1 → public target: followed once and served.
  let hops = 0;
  const ok: FetchLike = async (url) => {
    hops++;
    if (hops === 1) return new Response(null, { status: 301, headers: { Location: "https://example.org/final" } });
    assertEquals(url, "https://example.org/final");
    return htmlResponse("<title>Final</title><p>reached after redirect</p>");
  };
  const result = await fetchSource("https://example.com/start", { fetchImpl: ok, resolveDns: publicDnsAll });
  assertEquals(result.finalUrl, "https://example.org/final");
  assertEquals(hops, 2);
  assert(result.text.includes("reached after redirect"));
});

Deno.test("fetch: plain text responses pass through", async () => {
  const fetchImpl: FetchLike = async () => new Response("line one\nline two", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
  const result = await fetchSource("https://example.com/notes.txt", { fetchImpl, resolveDns: publicDnsAll });
  assertEquals(result.text, "line one line two");
  assertEquals(result.title, "");
});

Deno.test("stripHtml: caps output and decodes numeric entities", () => {
  const out = stripHtml("<p>${" + "a".repeat(500) + "}</p>&#169; &#x2713;", 50);
  assertEquals(out.length, 50);
  const decoded = stripHtml("<p>&#169; &#x2713; &amp; &lt;ok&gt;</p>");
  assertEquals(decoded, "© ✓ & <ok>");
});

// ── providers ──────────────────────────────────────────────────────────────

Deno.test("duckduckgo: parses results, decodes redirect links and snippets", async () => {
  const html = `
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fid%3D1&amp;rut=abc">Example <b>Page</b></a>
      <a class="result__snippet" href="#">A snippet about the thing &amp; more.</a>
    </div>
    <div class="result">
      <a rel="nofollow" class="result__a" href="https://other.org/post">Other Post</a>
      <a class="result__snippet" href="#">Second snippet.</a>
    </div>
    <div class="result">
      <a rel="nofollow" class="result__a" href="javascript:alert(1)">Bad Link</a>
    </div>`;
  const fetchImpl: FetchLike = async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  const provider = new DuckDuckGoProvider(fetchImpl);
  const sources = await provider.search("the thing", 5);
  assertEquals(sources.length, 2, "the javascript: link must be dropped");
  assertEquals(sources[0].url, "https://example.com/page?id=1");
  assertEquals(sources[0].domain, "example.com");
  assertEquals(sources[0].title, "Example Page");
  assertEquals(sources[0].snippet, "A snippet about the thing & more.");
  assertEquals(sources[1].url, "https://other.org/post");
  assertEquals(sources[0].rank, 1);
  assertEquals(sources[1].rank, 2, "ranks are assigned contiguously in result order");
  assertEquals(decodeDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fx&rut=1"), "https://a.test/x");
  assertEquals(decodeDdgHref("https://plain.test/x"), "https://plain.test/x");
});

Deno.test("google cse (web): parses items and surfaces HTTP failures", async () => {
  const okFetch: FetchLike = async (url) => {
    assert(url.includes("customsearch/v1"), "must call the CSE endpoint");
    assert(url.includes("q=react+server+components"), "query must be encoded");
    return new Response(JSON.stringify({
      items: [
        { title: "React Server Components", link: "https://react.dev/path#anchor", snippet: "Docs & guide", displayLink: "react.dev" },
        { title: "", link: "https://skip.test/", snippet: "no title" },
        { title: "FTP thing", link: "ftp://files.test/x", snippet: "" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const provider = new GoogleCseWebProvider({ apiKey: "k", engineId: "e" }, okFetch);
  const sources = await provider.search("react server components", 3);
  assertEquals(sources.length, 1, "untitled and non-http results are dropped");
  assertEquals(sources[0].url, "https://react.dev/path", "fragments are stripped");
  assertEquals(sources[0].domain, "react.dev");
  assertEquals(sources[0].snippet, "Docs & guide");

  const failFetch: FetchLike = async () => new Response("quota", { status: 429 });
  const failing = new GoogleCseWebProvider({ apiKey: "k", engineId: "e" }, failFetch);
  let threw = false;
  try { await failing.search("x"); } catch { threw = true; }
  assert(threw, "HTTP errors must surface (the caller degrades to normal chat)");
});

Deno.test("factory: free-first provider selection", () => {
  const withKeys: EnvReader = n => (n === "GOOGLE_CSE_API_KEY" ? "key" : n === "GOOGLE_CSE_ENGINE_ID" ? "cx" : undefined);
  const noKeys: EnvReader = () => undefined;
  assertEquals(createWebSearchProvider(withKeys)?.name, "google-cse-web");
  assertEquals(createWebSearchProvider(noKeys)?.name, "duckduckgo-html", "zero-config default must be the keyless path");
  assertEquals(createWebSearchProvider(n => (n === "WEB_SEARCH_PROVIDER" ? "off" : undefined)), null, "explicit off");
  assertEquals(
    createWebSearchProvider(n => (n === "WEB_SEARCH_PROVIDER" ? "duckduckgo" : undefined))?.name,
    "duckduckgo-html",
    "operator can force the keyless path even with keys present",
  );
});

// ── normalization / diversity ──────────────────────────────────────────────

Deno.test("sources: dedupe, domain diversity and contiguous citation ranks", () => {
  const source = (url: string, domain: string, rank: number, title = "T"): WebSearchSource =>
    ({ title, url, domain, rank });
  const output = normalizeSources([
    source("https://a.test/one", "a.test", 1, "Best ranked copy"),
    source("https://a.test/one#section", "a.test", 3, "older copy of the same page"),
    source("https://a.test/two", "a.test", 2),
    source("https://a.test/three", "a.test", 4, "over the per-domain cap"),
    source("https://b.test/x", "b.test", 5),
    source("https://b.test/y", "b.test", 6),
    source("ftp://bad.test/z", "bad.test", 7, "bad scheme"),
    source("https://no-title.test/", "no-title.test", 8, ""),
  ], { max: 6, maxPerDomain: 2 });
  assertEquals(output.map(s => s.url), ["https://a.test/one", "https://a.test/two", "https://b.test/x", "https://b.test/y"]);
  assertEquals(output.map(s => s.rank), [1, 2, 3, 4], "citation markers must be contiguous");
  assertEquals(output[0].title, "Best ranked copy", "the best-ranked copy wins the dedupe");
});

Deno.test("sources: normalizeWebUrl / domainOf edge cases", () => {
  assertEquals(normalizeWebUrl("HTTPS://Example.COM/a#frag"), "https://example.com/a");
  assertEquals(normalizeWebUrl("javascript:alert(1)"), null);
  assertEquals(normalizeWebUrl("  "), null);
  assertEquals(domainOf("https://www.example.com/x"), "example.com");
  assertEquals(domainOf("not a url"), "");
});

// ── research heuristic ─────────────────────────────────────────────────────

Deno.test("decision: explicit research phrasing triggers, chit-chat does not", () => {
  const triggers = [
    "Search the web for the latest React 19 features",
    "Find the latest news about the Mars sample return",
    "What's new in TypeScript this month?",
    "Give me sources for this claim about GDP",
    "Look up the current pricing for the Pro plan",
    "According to the web, who won the 2026 world cup?",
    "Search online for recent developments in solid-state batteries",
    "Compare the sources on intermittent fasting",
  ];
  for (const message of triggers) assert(shouldResearch(message), `should research: ${message}`);

  const quiet = [
    "Hello there, how are you today?",
    "Write a function that sorts an array",
    "Summarise this document for me please",
    "What is the capital of France?",
    "Calculate 2 + 2",
    "search", // too short
  ];
  for (const message of quiet) assert(!shouldResearch(message), `must NOT research: ${message}`);
});

// ── prompt block & events ──────────────────────────────────────────────────

Deno.test("prompt: sources are numbered with citation instructions", () => {
  const block = sourcesPromptBlock([
    { title: "Alpha", url: "https://a.test/x", domain: "a.test", snippet: "About alpha", rank: 1 },
    { title: "Beta", url: "https://b.test/y", domain: "b.test", rank: 2 },
  ]);
  assert(block.includes("[1] Alpha (a.test)"));
  assert(block.includes("[2] Beta (b.test)"));
  assert(block.includes("https://a.test/x"));
  assert(block.includes("Excerpt: About alpha"));
  assert(block.includes("cite them inline as [1], [2]"));
  assert(block.includes("never invent additional URLs"));
});

Deno.test("events: SSE frames round-trip and malformed input is dropped", () => {
  const sources: WebSearchSource[] = [{ title: "T", url: "https://a.test/", domain: "a.test", rank: 1 }];
  const frame = sseWebSearchEvent({ type: "results", sources });
  assertEquals(frame, `event: web_search\ndata: ${JSON.stringify({ type: "results", sources })}\n\n`);
  const parsed = parseWebSearchEvent(JSON.stringify({ type: "results", sources }));
  assertEquals(parsed, { type: "results", sources });
  assertEquals(parseWebSearchEvent(JSON.stringify({ type: "results", sources: [{ bogus: true }] }))?.type, "results");
  assertEquals((parseWebSearchEvent(JSON.stringify({ type: "results", sources: [{ bogus: true }] })) as { sources: unknown[] }).sources.length, 0);
  assertEquals(parseWebSearchEvent(JSON.stringify({ type: "error", message: "nope" })), { type: "error", message: "nope" });
  assertEquals(parseWebSearchEvent("not json"), null);
  assertEquals(parseWebSearchEvent(JSON.stringify({ type: "unknown" })), null);
});

Deno.test("stripHtml: closing tags with attributes or spaces still end the block", () => {
  const html = "a<script>evil()</script foo=bar>b<style>x{}</style >c<!-- hidden --!>d";
  assertEquals(stripHtml(html), "a b c d");
});
