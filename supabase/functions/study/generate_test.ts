/**
 * Offline tests for study-pack generation: prompt building, JSON extraction,
 * output validation and the model call (scripted fetch, no network/env).
 */
import {
  buildStudyMessages,
  extractJsonObject,
  generateStudyPack,
  parseStudyPack,
  StudyGenerationError,
  transcriptToText,
} from "./generate.ts";
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
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

const PACK_JSON = JSON.stringify({
  title: "Quantum basics",
  summary: "An intro to qubits.",
  notes: [{ heading: "Qubits", body: "A qubit can be 0 or 1.", timestamp: 12 }],
  quiz: [{
    question: "What is a qubit?",
    options: ["A classical bit", "A quantum bit", "A byte", "A nibble"],
    answerIndex: 1,
    explanation: "Qubits are quantum bits.",
    timestamp: 12,
  }],
  flashcards: [{ front: "Qubit?", back: "A quantum bit.", timestamp: 12 }],
});

// ── transcriptToText / buildStudyMessages ──────────────────────────────────

Deno.test("transcriptToText keeps timestamps", () => {
  const text = transcriptToText([
    { start: 1.5, duration: 2, text: "Hello" },
    { start: 4, duration: 1, text: "world" },
  ]);
  assertEquals(text, "[2s] Hello\n[4s] world");
});

Deno.test("buildStudyMessages wraps the transcript and marks truncation", () => {
  const messages = buildStudyMessages("abc12345678", "[1s] hi there", true, "Hindi");
  assertEquals(messages.length, 2);
  assertEquals(messages[0].role, "system");
  assert(messages[0].content.includes("study assistant"), "system prompt present");
  assert(messages[0].content.includes("Hindi"), "language prompt present");
  assert(messages[1].content.includes("abc12345678"), "video id present");
  assert(messages[1].content.includes("truncated for length"), "truncation flag present");
  assert(messages[1].content.includes("[1s] hi there"), "transcript present");
});

// ── extractJsonObject ──────────────────────────────────────────────────────

Deno.test("extractJsonObject pulls the first JSON object out of prose", () => {
  const payload = extractJsonObject(`Here is the pack:\n${PACK_JSON}\nDone.`);
  assert(payload !== null, "object should be extracted");
  assertEquals((payload as { title: string }).title, "Quantum basics");
});

Deno.test("extractJsonObject returns null without a balanced object", () => {
  assertEquals(extractJsonObject("no json at all"), null);
  assertEquals(extractJsonObject('{"unbalanced": true'), null);
});

// ── parseStudyPack ─────────────────────────────────────────────────────────

Deno.test("parseStudyPack validates and normalizes a payload", () => {
  const pack = parseStudyPack(JSON.parse(PACK_JSON));
  assertEquals(pack.title, "Quantum basics");
  assertEquals(pack.notes.length, 1);
  assertEquals(pack.notes[0].timestamp, 12);
  assertEquals(pack.quiz[0].answerIndex, 1);
  assertEquals(pack.flashcards[0].front, "Qubit?");
});

Deno.test("parseStudyPack repairs out-of-range answers and bad timestamps", () => {
  const pack = parseStudyPack({
    notes: [],
    quiz: [{
      question: "Q",
      options: ["a", "b"],
      answerIndex: 9,
      explanation: "",
      timestamp: -5,
    }],
    flashcards: [],
  });
  assertEquals(pack.quiz[0].answerIndex, 0);
  assertEquals(pack.quiz[0].timestamp, null);
});

Deno.test("parseStudyPack rejects payloads with no usable sections", () => {
  let error: unknown;
  try {
    parseStudyPack({ title: "x" });
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyGenerationError, "should throw StudyGenerationError");
  assertEquals(error.code, "invalid_output");
});

// ── generateStudyPack ──────────────────────────────────────────────────────

Deno.test("generateStudyPack returns a pack from a working free model", async () => {
  const fetchImpl: FetchLike = async () => response(
    JSON.stringify({ choices: [{ message: { content: PACK_JSON } }] }),
  );
  const pack = await generateStudyPack({
    env: (name) => (name === "GROQ_API_KEY" ? "test-key" : undefined),
    fetchImpl,
    videoId: "abc12345678",
    transcriptText: "[1s] hello world",
    truncated: false,
  });
  assertEquals(pack.title, "Quantum basics");
  assertEquals(pack.flashcards.length, 1);
});

Deno.test("generateStudyPack falls back to another free provider on failure", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    calls.push(input);
    if (input.includes("groq.com")) return response("provider exploded", 503);
    if (input.includes("openrouter.ai")) {
      return response(JSON.stringify({ choices: [{ message: { content: PACK_JSON } }] }));
    }
    return response("unexpected", 500);
  };
  const pack = await generateStudyPack({
    env: (name) => (name === "GROQ_API_KEY" || name === "OPENROUTER_API_KEY" ? "test-key" : undefined),
    fetchImpl,
    videoId: "abc12345678",
    transcriptText: "[1s] hello",
    truncated: false,
  });
  assertEquals(pack.title, "Quantum basics");
  assert(calls.some((u) => u.includes("groq.com")), "groq was tried first");
  assert(calls.some((u) => u.includes("openrouter.ai")), "openrouter was tried as fallback");
});

Deno.test("generateStudyPack errors when no provider key is configured", async () => {
  let error: unknown;
  try {
    await generateStudyPack({
      env: () => undefined,
      fetchImpl: async () => response("{}"),
      videoId: "abc12345678",
      transcriptText: "[1s] hello",
      truncated: false,
    });
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyGenerationError, "should throw StudyGenerationError");
  assertEquals(error.code, "no_model");
});

Deno.test("generateStudyPack errors when every provider fails", async () => {
  let error: unknown;
  try {
    await generateStudyPack({
      env: (name) => (name === "GROQ_API_KEY" ? "test-key" : undefined),
      fetchImpl: async () => response("boom", 500),
      videoId: "abc12345678",
      transcriptText: "[1s] hello",
      truncated: false,
    });
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyGenerationError, "should throw StudyGenerationError");
  assertEquals(error.code, "generation_failed");
});

Deno.test("generateStudyPack rejects model output that is not a study pack", async () => {
  let error: unknown;
  try {
    await generateStudyPack({
      env: (name) => (name === "GROQ_API_KEY" ? "test-key" : undefined),
      fetchImpl: async () => response(
        JSON.stringify({ choices: [{ message: { content: "I cannot help with that." } }] }),
      ),
      videoId: "abc12345678",
      transcriptText: "[1s] hello",
      truncated: false,
    });
  } catch (e) {
    error = e;
  }
  assert(error instanceof StudyGenerationError, "should throw StudyGenerationError");
  assertEquals(error.code, "invalid_output");
});
