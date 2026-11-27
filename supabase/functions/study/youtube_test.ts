/**
 * Offline tests for the YouTube transcript helpers (URL parsing, caption track
 * extraction, timedtext parsing, track selection). Scripted fetch, no network.
 */
import {
  StudyFetchError,
  extractJsonArray,
  fetchTranscript,
  parseTimedTextXml,
  parseVideoId,
  pickTrack,
} from "./youtube.ts";
import type { FetchLike } from "./youtube.ts";

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

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

const WATCH_HTML = `<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},
"captionTracks":[
 {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc12345678&lang=en","name":{"simpleText":"English"},"languageCode":"en","kind":"asr"},
 {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc12345678&lang=hi","name":{"simpleText":"हिन्दी"},"languageCode":"hi"}
]};</script></html>`;

const XML = `<?xml version="1.0"?><transcript><text start="1.5" dur="2.5">Hello &amp; welcome</text>
<text start="4.0" dur="3.0">to the video &#346;</text>
<text start="7.0">Tail text</text></transcript>`;

// ── parseVideoId ────────────────────────────────────────────────────────────

Deno.test("parseVideoId accepts watch URLs", () => {
  assertEquals(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(parseVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s"), "dQw4w9WgXcQ");
  assertEquals(parseVideoId("http://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

Deno.test("parseVideoId accepts shorts, youtu.be, embed and bare ids", () => {
  assertEquals(parseVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(parseVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(parseVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(parseVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(parseVideoId("youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

Deno.test("parseVideoId rejects non-YouTube and malformed input", () => {
  assertEquals(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assertEquals(parseVideoId("https://www.youtube.com/watch?v=short"), null);
  assertEquals(parseVideoId("not a url at all!!"), null);
  assertEquals(parseVideoId(""), null);
});

// ── extractJsonArray ───────────────────────────────────────────────────────

Deno.test("extractJsonArray finds a balanced array after the key", () => {
  const arr = extractJsonArray(WATCH_HTML, "captionTracks");
  assert(arr !== null, "captionTracks array should be found");
  assertEquals(arr.length, 2);
});

Deno.test("extractJsonArray handles strings containing brackets", () => {
  const html = `prefix "captionTracks":[{"baseUrl":"http://x/[y]","name":{"simpleText":"a[b]"}}] suffix`;
  const arr = extractJsonArray(html, "captionTracks");
  assert(arr !== null, "array with brackets inside strings should parse");
  assertEquals(arr.length, 1);
});

Deno.test("extractJsonArray returns null when the key is absent", () => {
  assertEquals(extractJsonArray("<html>nothing here</html>", "captionTracks"), null);
});

// ── pickTrack ──────────────────────────────────────────────────────────────

Deno.test("pickTrack prefers English human captions", () => {
  const tracks = [
    { baseUrl: "u1", languageCode: "hi" },
    { baseUrl: "u2", languageCode: "en" },
    { baseUrl: "u3", kind: "asr", languageCode: "en" },
  ];
  assertEquals(pickTrack(tracks as never)?.baseUrl, "u2");
});

Deno.test("pickTrack falls back to ASR when no human track exists", () => {
  const tracks = [{ baseUrl: "u1", kind: "asr", languageCode: "en" }];
  assertEquals(pickTrack(tracks as never)?.baseUrl, "u1");
});

// ── parseTimedTextXml ──────────────────────────────────────────────────────

Deno.test("parseTimedTextXml decodes entities and numbers", () => {
  const segments = parseTimedTextXml(XML);
  assertEquals(segments.length, 3);
  assertEquals(segments[0], { start: 1.5, duration: 2.5, text: "Hello & welcome" });
  assertEquals(segments[1].text, "to the video Ś");
  assertEquals(segments[2], { start: 7, duration: 0, text: "Tail text" });
});

Deno.test("parseTimedTextXml returns empty for garbage", () => {
  assertEquals(parseTimedTextXml("<html>nope</html>"), []);
});

// ── fetchTranscript ───────────────────────────────────────────────────────

Deno.test("fetchTranscript fetches the watch page then the timedtext URL", async () => {
  const fetchImpl: FetchLike = async (input) => {
    if (input.includes("/watch?")) return response(WATCH_HTML);
    if (input.includes("timedtext")) return response(XML);
    throw new Error(`unexpected url ${input}`);
  };
  const result = await fetchTranscript("dQw4w9WgXcQ", fetchImpl);
  assert(!result.truncated, "short transcript is not truncated");
  assertEquals(result.segments.length, 3);
});

Deno.test("fetchTranscript trims long transcripts and flags truncated", async () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    `<text start="${i}" dur="1">word${i}</text>`).join("");
  const fetchImpl: FetchLike = async (input) => {
    if (input.includes("/watch?")) return response(WATCH_HTML);
    return response(`<transcript>${many}</transcript>`);
  };
  const result = await fetchTranscript("dQw4w9WgXcQ", fetchImpl, 120);
  assert(result.truncated, "long transcript should be flagged truncated");
  assert(result.segments.length < 200, "transcript should be trimmed");
});

Deno.test("fetchTranscript reports no_captions when the watch page has none", async () => {
  const fetchImpl: FetchLike = async () => response(`<html><script>ytInitialPlayerResponse={"playabilityStatus":{"status":"OK"}};</script></html>`);
  let error: unknown;
  try {
    await fetchTranscript("dQw4w9WgXcQ", fetchImpl);
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyFetchError, "should throw StudyFetchError");
  assertEquals(error.code, "no_captions");
});

Deno.test("fetchTranscript reports video_unavailable for playability errors", async () => {
  const fetchImpl: FetchLike = async () => response(`<html>"playabilityStatus":{"status":"ERROR"}</html>`);
  let error: unknown;
  try {
    await fetchTranscript("dQw4w9WgXcQ", fetchImpl);
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyFetchError, "should throw StudyFetchError");
  assertEquals(error.code, "video_unavailable");
});

Deno.test("fetchTranscript reports network errors on HTTP failures", async () => {
  const fetchImpl: FetchLike = async () => response("boom", 500);
  let error: unknown;
  try {
    await fetchTranscript("dQw4w9WgXcQ", fetchImpl);
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyFetchError, "should throw StudyFetchError");
  assertEquals(error.code, "network");
});
