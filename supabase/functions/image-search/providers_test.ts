/**
 * Offline tests for the image search modules.
 *
 * Everything here runs without network or env access: `fetch` is injected and
 * API keys are passed through a fake env reader. Run with:
 *   deno test supabase/functions/image-search/providers_test.ts
 */
import {
  createImageSearchProvider,
  filterResults,
  GoogleCSEProvider,
  redactImageSearchSecrets,
  type EnvReader,
  type FetchLike,
  type ImageResult,
} from "./providers.ts";
import { TTLCache } from "./cache.ts";
import {
  decideImageSearch,
  quickHeuristicCheck,
} from "./decision.ts";
import {
  parseImageSearchEvent,
  sseImageSearchEvent,
  type ImageSearchEvent,
} from "./search-events.ts";

// ── assertions (hand-rolled: the suite has zero dependencies) ──────────────

class AssertionError extends Error {
  constructor(message: string) { super(message); this.name = "AssertionError"; }
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message ?? "expected a truthy value");
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  }
}

function assertMatch(actual: string, expected: RegExp, message?: string): void {
  if (!expected.test(actual)) throw new AssertionError(message ?? `expected ${show(actual)} to match ${expected}`);
}

function assertNotMatch(actual: string, expected: RegExp, message?: string): void {
  if (expected.test(actual)) throw new AssertionError(message ?? `expected ${show(actual)} not to match ${expected}`);
}

// ── helpers ─────────────────────────────────────────────────────────────────

const GOOGLE_API_KEY = "AIzaTESTKEY123456789012345678901234567890";
const GOOGLE_ENGINE_ID = "test-engine-id-12345";

const env: EnvReader = (name) => {
  if (name === "GOOGLE_CSE_API_KEY") return GOOGLE_API_KEY;
  if (name === "GOOGLE_CSE_ENGINE_ID") return GOOGLE_ENGINE_ID;
  if (name === "GROQ_API_KEY") return "gsk_test_key_1234567890";
  return undefined;
};

const noKeys: EnvReader = () => undefined;

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeGoogleCSE(items: Array<{ link: string; title: string; displayLink?: string; image?: Partial<ImageResult["thumbnail"]> }>): Response {
  return jsonOk({
    items: items.map(item => ({
      link: item.link,
      title: item.title,
      displayLink: item.displayLink,
      image: {
        thumbnailLink: `https://thumbnail.example.com/${item.link}`,
        contextLink: `https://source.example.com/${item.link}`,
        width: 800,
        height: 600,
        ...item.image,
      },
    })),
  });
}

// ── Provider Tests ──────────────────────────────────────────────────────────

Deno.test("provider: createImageSearchProvider returns null when keys are missing", () => {
  const provider = createImageSearchProvider(noKeys);
  assertEquals(provider, null);
});

Deno.test("provider: createImageSearchProvider returns a provider when keys are present", () => {
  const provider = createImageSearchProvider(env);
  assert(provider !== null);
  assertEquals(provider.name, "google-cse");
});

Deno.test("provider: GoogleCSEProvider parses valid results", async () => {
  const mockItems = [
    { link: "https://example.com/image1.jpg", title: "Golden Retriever", displayLink: "example.com" },
    { link: "https://example.com/image2.jpg", title: "Labrador", displayLink: "example.com" },
  ];
  const fetchImpl: FetchLike = async () => makeGoogleCSE(mockItems);
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("dogs");
  assertEquals(results.length, 2);
  assertEquals(results[0].url, "https://example.com/image1.jpg");
  assertEquals(results[0].title, "Golden Retriever");
  assertEquals(results[0].sourceName, "example.com");
  assert(results[0].thumbnail.includes("thumbnail.example.com"));
});

Deno.test("provider: filters out low-resolution images", async () => {
  const mockItems = [
    { link: "https://example.com/good.jpg", title: "Good Image", image: { width: 800, height: 600 } },
    { link: "https://example.com/tiny.jpg", title: "Tiny Image", image: { width: 100, height: 80 } },
  ];
  const fetchImpl: FetchLike = async () => makeGoogleCSE(mockItems);
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("test");
  assertEquals(results.length, 1);
  assertEquals(results[0].url, "https://example.com/good.jpg");
});

Deno.test("provider: filters out duplicate URLs", async () => {
  const mockItems = [
    { link: "https://example.com/image1.jpg", title: "Image 1" },
    { link: "https://example.com/image1.jpg", title: "Image 1 duplicate" },
    { link: "https://example.com/image2.jpg", title: "Image 2" },
  ];
  const fetchImpl: FetchLike = async () => makeGoogleCSE(mockItems);
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("test");
  assertEquals(results.length, 2);
  const urls = results.map(r => r.url);
  assertEquals(new Set(urls).size, 2); // All unique
});

Deno.test("provider: returns empty array on network failure", async () => {
  const fetchImpl: FetchLike = async () => { throw new Error("Network error"); };
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("test");
  assertEquals(results, []);
});

Deno.test("provider: returns empty array on HTTP error", async () => {
  const fetchImpl: FetchLike = async () => new Response("Unauthorized", { status: 401 });
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("test");
  assertEquals(results, []);
});

Deno.test("provider: returns empty array on invalid JSON", async () => {
  const fetchImpl: FetchLike = async () => new Response("not json", { status: 200 });
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("test");
  assertEquals(results, []);
});

// ── Filter Tests ────────────────────────────────────────────────────────────

Deno.test("filter: removes results with missing required fields", () => {
  const results: ImageResult[] = [
    { url: "https://example.com/1.jpg", thumbnail: "https://thumb.com/1.jpg", title: "Good", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "", thumbnail: "https://thumb.com/2.jpg", title: "No URL", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "https://example.com/3.jpg", thumbnail: "", title: "No thumbnail", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "https://example.com/4.jpg", thumbnail: "https://thumb.com/4.jpg", title: "", sourceUrl: "https://example.com", sourceName: "example.com" },
  ];

  const filtered = filterResults(results);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].url, "https://example.com/1.jpg");
});

Deno.test("filter: removes results with invalid URLs", () => {
  const results: ImageResult[] = [
    { url: "not-a-url", thumbnail: "https://thumb.com/1.jpg", title: "Bad URL", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "https://example.com/2.jpg", thumbnail: "also-not-a-url", title: "Bad thumbnail", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "https://example.com/3.jpg", thumbnail: "https://thumb.com/3.jpg", title: "Good", sourceUrl: "https://example.com", sourceName: "example.com" },
  ];

  const filtered = filterResults(results);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].url, "https://example.com/3.jpg");
});

Deno.test("filter: removes duplicate URLs", () => {
  const results: ImageResult[] = [
    { url: "https://example.com/1.jpg", thumbnail: "https://thumb.com/1.jpg", title: "Image 1", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "https://example.com/1.jpg", thumbnail: "https://thumb.com/1.jpg", title: "Image 1 duplicate", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "https://example.com/2.jpg", thumbnail: "https://thumb.com/2.jpg", title: "Image 2", sourceUrl: "https://example.com", sourceName: "example.com" },
  ];

  const filtered = filterResults(results);
  assertEquals(filtered.length, 2);
});

Deno.test("filter: removes extremely low resolution images", () => {
  const results: ImageResult[] = [
    { url: "https://example.com/1.jpg", thumbnail: "https://thumb.com/1.jpg", title: "Tiny", sourceUrl: "https://example.com", sourceName: "example.com", width: 100, height: 80 },
    { url: "https://example.com/2.jpg", thumbnail: "https://thumb.com/2.jpg", title: "Normal", sourceUrl: "https://example.com", sourceName: "example.com", width: 800, height: 600 },
    { url: "https://example.com/3.jpg", thumbnail: "https://thumb.com/3.jpg", title: "Unknown size", sourceUrl: "https://example.com", sourceName: "example.com" },
  ];

  const filtered = filterResults(results);
  assertEquals(filtered.length, 2);
  assertEquals(filtered[0].url, "https://example.com/2.jpg");
  assertEquals(filtered[1].url, "https://example.com/3.jpg");
});

// ── Cache Tests ─────────────────────────────────────────────────────────────

Deno.test("cache: stores and retrieves values", () => {
  const cache = new TTLCache<string>(1000);
  cache.set("key1", "value1");
  assertEquals(cache.get("key1"), "value1");
});

Deno.test("cache: returns undefined for missing keys", () => {
  const cache = new TTLCache<string>(1000);
  assertEquals(cache.get("missing"), undefined);
});

Deno.test("cache: expires values after TTL", () => {
  const cache = new TTLCache<string>(1); // 1ms TTL
  cache.set("key1", "value1");
  // Wait for expiration
  const start = Date.now();
  while (Date.now() - start < 10) { /* busy wait */ }
  assertEquals(cache.get("key1"), undefined);
});

Deno.test("cache: respects max size", () => {
  const cache = new TTLCache<string>(60000, 3); // max 3 entries
  cache.set("key1", "value1");
  cache.set("key2", "value2");
  cache.set("key3", "value3");
  cache.set("key4", "value4"); // Should evict oldest
  assertEquals(cache.size, 3);
  assertEquals(cache.get("key4"), "value4");
});

Deno.test("cache: has() returns true for existing keys", () => {
  const cache = new TTLCache<string>(1000);
  cache.set("key1", "value1");
  assert(cache.has("key1"));
  assert(!cache.has("missing"));
});

Deno.test("cache: delete() removes a key", () => {
  const cache = new TTLCache<string>(1000);
  cache.set("key1", "value1");
  cache.delete("key1");
  assertEquals(cache.get("key1"), undefined);
});

Deno.test("cache: clear() removes all keys", () => {
  const cache = new TTLCache<string>(1000);
  cache.set("key1", "value1");
  cache.set("key2", "value2");
  cache.clear();
  assertEquals(cache.size, 0);
});

// ── Decision Tests ──────────────────────────────────────────────────────────

Deno.test("decision: triggers for explicit image requests", () => {
  assertEquals(quickHeuristicCheck("Show me pictures of golden retrievers"), "visual");
  assertEquals(quickHeuristicCheck("Find images of mountain landscapes"), "visual");
  assertEquals(quickHeuristicCheck("I want wallpaper of the ocean"), "visual");
});

Deno.test("decision: does not trigger for math/calculation queries", () => {
  assertEquals(quickHeuristicCheck("Calculate 2 + 2"), "non-visual");
  assertEquals(quickHeuristicCheck("What is 15 * 23?"), "non-visual");
  assertEquals(quickHeuristicCheck("Solve x^2 + 3x + 2 = 0"), "non-visual");
});

Deno.test("decision: does not trigger for code/debugging queries", () => {
  assertEquals(quickHeuristicCheck("Write a function that sorts an array"), "non-visual");
  assertEquals(quickHeuristicCheck("Debug this React component"), "non-visual");
  assertEquals(quickHeuristicCheck("```js\nconst x = 1;\n```"), "non-visual");
});

Deno.test("decision: does not trigger for greetings and simple questions", () => {
  assertEquals(quickHeuristicCheck("Hello"), "non-visual");
  assertEquals(quickHeuristicCheck("Thanks!"), "non-visual");
  assertEquals(quickHeuristicCheck("What is the capital of France?"), "non-visual");
});

Deno.test("decision: returns null for uncertain queries", () => {
  assertEquals(quickHeuristicCheck("Tell me about dogs"), null);
  assertEquals(quickHeuristicCheck("Compare iPhone and Android"), null);
  assertEquals(quickHeuristicCheck("Short"), null); // Too short
});

Deno.test("decision: decideImageSearch uses heuristic for obvious cases", async () => {
  const decision = await decideImageSearch("Show me pictures of cats", {
    env,
    fetchImpl: async () => new Response(),
    heuristicOnly: true,
  });
  assert(decision.shouldSearch);
  assertEquals(decision.confidence, "high");
  assert(decision.queries.length > 0);
});

Deno.test("decision: decideImageSearch skips non-visual queries", async () => {
  const decision = await decideImageSearch("Calculate 2 + 2", {
    env,
    fetchImpl: async () => new Response(),
    heuristicOnly: true,
  });
  assert(!decision.shouldSearch);
  assertEquals(decision.confidence, "high");
});

// ── SSE Event Tests ─────────────────────────────────────────────────────────

Deno.test("sse: sseImageSearchEvent formats started event correctly", () => {
  const event: ImageSearchEvent = { type: "started", queries: ["cats", "kittens"] };
  const sse = sseImageSearchEvent(event);
  assertMatch(sse, /^event: image_search\n/);
  assertMatch(sse, /"type":"started"/);
  assertMatch(sse, /"queries":\["cats","kittens"\]/);
});

Deno.test("sse: sseImageSearchEvent formats results event correctly", () => {
  const event: ImageSearchEvent = {
    type: "results",
    images: [
      { url: "https://example.com/1.jpg", thumbnail: "https://thumb.com/1.jpg", title: "Cat", sourceUrl: "https://example.com", sourceName: "example.com" },
    ],
  };
  const sse = sseImageSearchEvent(event);
  assertMatch(sse, /"type":"results"/);
  assertMatch(sse, /"images":\[/);
  assertMatch(sse, /"url":"https:\/\/example\.com\/1\.jpg"/);
});

Deno.test("sse: sseImageSearchEvent formats error event correctly", () => {
  const event: ImageSearchEvent = { type: "error", message: "Search failed" };
  const sse = sseImageSearchEvent(event);
  assertMatch(sse, /"type":"error"/);
  assertMatch(sse, /"message":"Search failed"/);
});

Deno.test("sse: parseImageSearchEvent parses valid events", () => {
  const started = parseImageSearchEvent('{"type":"started","queries":["cats"]}');
  assertEquals(started?.type, "started");
  if (started?.type === "started") assertEquals(started.queries, ["cats"]);

  const results = parseImageSearchEvent('{"type":"results","images":[]}');
  assertEquals(results?.type, "results");

  const error = parseImageSearchEvent('{"type":"error","message":"Failed"}');
  assertEquals(error?.type, "error");
  if (error?.type === "error") assertEquals(error.message, "Failed");
});

Deno.test("sse: parseImageSearchEvent returns null for invalid data", () => {
  assertEquals(parseImageSearchEvent("not json"), null);
  assertEquals(parseImageSearchEvent('{"type":"unknown"}'), null);
  assertEquals(parseImageSearchEvent('{"queries":["cats"]}'), null); // missing type
});

// ── Security Tests ──────────────────────────────────────────────────────────

Deno.test("security: redactImageSearchSecrets removes API keys from logs", () => {
  const text = `Error with key ${GOOGLE_API_KEY} in request`;
  const redacted = redactImageSearchSecrets(text, [GOOGLE_API_KEY]);
  assertNotMatch(redacted, new RegExp(GOOGLE_API_KEY));
  assertMatch(redacted, /\[redacted\]/);
});

Deno.test("security: redactImageSearchSecrets removes generic Google key patterns", () => {
  const text = `Key is AIzaSyA1234567890abcdefghijklmnopqrstuv`;
  const redacted = redactImageSearchSecrets(text);
  assertNotMatch(redacted, /AIzaSy/);
  assertMatch(redacted, /\[redacted\]/);
});

Deno.test("security: provider never exposes API keys in error messages", async () => {
  const fetchImpl: FetchLike = async () => new Response(`Error: invalid key ${GOOGLE_API_KEY}`, { status: 401 });
  const provider = new GoogleCSEProvider({ apiKey: GOOGLE_API_KEY, engineId: GOOGLE_ENGINE_ID }, fetchImpl);

  const results = await provider.search("test");
  assertEquals(results, []);
  // The error is logged server-side but never returned to the client
});

Deno.test("security: filterResults never returns results with missing required fields", () => {
  const results: ImageResult[] = [
    { url: "https://example.com/1.jpg", thumbnail: "https://thumb.com/1.jpg", title: "Good", sourceUrl: "https://example.com", sourceName: "example.com" },
    { url: "", thumbnail: "https://thumb.com/2.jpg", title: "No URL", sourceUrl: "https://example.com", sourceName: "example.com" },
  ];

  const filtered = filterResults(results);
  for (const result of filtered) {
    assert(result.url.length > 0, "URL must not be empty");
    assert(result.thumbnail.length > 0, "Thumbnail must not be empty");
    assert(result.title.length > 0, "Title must not be empty");
    assert(result.sourceUrl.length > 0, "Source URL must not be empty");
  }
});
