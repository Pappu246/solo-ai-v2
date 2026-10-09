/**
 * Routing evaluation & benchmark (Phase 16).
 *
 * `classifyRoute` decides where every Auto-routed message goes, yet it is a
 * heuristic — so this suite LABELS queries with their ground-truth route, runs
 * them through the real classifier, and MEASURES accuracy per category. The
 * thresholds below assert the measured values; they are not aspirational
 * numbers. Known limits (queries a human would label differently than the
 * keyword scorer does) are asserted explicitly as documented behaviour, and a
 * throughput benchmark guards against an accidental complexity regression.
 *
 * Run with: deno test supabase/functions/chat/routing_test.ts
 */
import { classifyRoute, ROUTE_KEYWORDS, type QueryRoute } from "./routing.ts";
import { MODELS, selectAutoModel } from "./providers.ts";

// ── assertions (hand-rolled: the suite has zero dependencies) ──────────────

class AssertionError extends Error {
  constructor(message: string) { super(message); this.name = "AssertionError"; }
}
function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message ?? "expected a truthy value");
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── labelled fixture set ───────────────────────────────────────────────────

interface Fixture {
  text: string;
  /** What a human would say the message is asking for. */
  route: QueryRoute;
}

const FIXTURES: Fixture[] = [
  // conversation — no route is asked for
  { text: "hello there", route: "conversation" },
  { text: "what's the weather like today", route: "conversation" },
  { text: "tell me a joke about penguins", route: "conversation" },
  { text: "who won the super bowl in 1994", route: "conversation" },
  { text: "thanks!", route: "conversation" },
  { text: "can you help me with something", route: "conversation" },
  // coding
  { text: "write a python function to parse csv", route: "coding" },
  { text: "debug this typescript type error", route: "coding" },
  { text: "why is my react useEffect firing twice", route: "coding" },
  { text: "optimize this sql query for speed", route: "coding" },
  { text: "explain this javascript error", route: "coding" },
  { text: "how do i create an api endpoint", route: "coding" },
  { text: "algorithm for sorting an array", route: "coding" },
  // reasoning
  { text: "explain how photosynthesis works", route: "reasoning" },
  { text: "calculate the compound interest on 10000", route: "reasoning" },
  { text: "compare the pros and cons of leasing vs buying", route: "reasoning" },
  { text: "solve this logic puzzle", route: "reasoning" },
  { text: "analyze the strategy behind this opening move", route: "reasoning" },
  { text: "what is the proof that prime numbers are infinite", route: "reasoning" },
  // research
  { text: "latest news about the election", route: "research" },
  { text: "research the history of cryptography", route: "research" },
  { text: "find facts about mount everest", route: "research" },
  { text: "write a report on world war 2", route: "research" },
  { text: "search for recent studies on mri treatment", route: "research" },
  { text: "a paper on renewable energy", route: "research" },
  // fast
  { text: "summarize this article in one paragraph", route: "fast" },
  { text: "translate this sentence to french", route: "fast" },
  { text: "give me a short summary of the iliad", route: "fast" },
  { text: "brief overview please", route: "fast" },
  { text: "a simple explanation of relativity", route: "fast" },
  { text: "quick yes or no question", route: "fast" },
];

// ── exact-behaviour tests (deterministic rules of the scorer) ──────────────

Deno.test("routing eval: empty or keyword-free input falls back to conversation", () => {
  assertEquals(classifyRoute(""), "conversation");
  assertEquals(classifyRoute("   "), "conversation");
  assertEquals(classifyRoute("HELLO THERE"), "conversation");
});

Deno.test("routing eval: classification is case-insensitive", () => {
  assertEquals(classifyRoute("SuMmArIzE ThIs ArTiClE"), "fast");
  assertEquals(classifyRoute("DEBUG The Parser"), "coding");
});

Deno.test("routing eval: ties keep declaration order (coding → reasoning → research → fast)", () => {
  // "code" (coding, 4) and "find" (research, 4) score equally; the earlier
  // declared category wins. Documented so a keyword re-order is a conscious
  // decision, not an accident.
  assertEquals(classifyRoute("code find"), "coding");
});

Deno.test("routing eval: matching is by substring — decoded words score too", () => {
  // Known quirk of substring scoring: "decode" contains "code", "rapid"
  // contains "api". The scorer is a fast path, not a tokenizer.
  assertEquals(classifyRoute("decode the payload"), "coding");
  assertEquals(classifyRoute("rapid fire questions"), "coding");
});

Deno.test("routing eval: known limits — keyword-free intents route to conversation", () => {
  // A human labels this reasoning (it is arithmetic), but no reasoning
  // keyword appears. Asserted here so the limit stays documented; if someone
  // adds digits-as-math detection these assertions should change with it.
  assertEquals(classifyRoute("what's 15% of 240"), "conversation");
  // Mixed intent: research (14) out-scores summarize (9); the dominant topic
  // wins over the verb, which is the intended tiebreak-by-score behaviour.
  assertEquals(classifyRoute("summarize the latest research on diabetes"), "research");
});

Deno.test("routing eval: the keyword table covers exactly the four non-default routes", () => {
  const keys = Object.keys(ROUTE_KEYWORDS).sort();
  assertEquals(keys, ["coding", "fast", "reasoning", "research"]);
  for (const words of Object.values(ROUTE_KEYWORDS)) {
    assert(words.length > 0, "every route needs at least one keyword");
    assert(words.every(w => w === w.toLowerCase() && w.length > 1), "keywords are lower-case and longer than one char");
  }
});

// ── measured accuracy over the labelled set ────────────────────────────────

Deno.test("routing eval: measured accuracy on the labelled fixture set", () => {
  const results = FIXTURES.map((f) => ({ ...f, actual: classifyRoute(f.text) }));
  const misses = results.filter(r => r.actual !== r.route);

  // Per-category report (readable when the suite fails).
  const routes: QueryRoute[] = ["conversation", "coding", "reasoning", "research", "fast"];
  const report = routes.map((route) => {
    const inRoute = results.filter(r => r.route === route);
    const hits = inRoute.filter(r => r.actual === route).length;
    return `${route}: ${hits}/${inRoute.length}`;
  }).join("  ");
  console.log(`[routing eval] ${results.length - misses.length}/${results.length} correct — ${report}`);

  // Measured values on this fixture set: every labelled query classifies to
  // its ground-truth route. A regression shows up as a listed miss above.
  assertEquals(
    misses.map(m => `${m.text} → ${m.actual} (labelled ${m.route})`),
    [],
    "route classification regressed on the labelled set",
  );
  assertEquals(results.length, 31, "fixture set changed — update the measured counts above");
});

// ── classifier → router integration ────────────────────────────────────────

Deno.test("routing eval: every classified route feeds selectAutoModel a usable model", () => {
  const routes = new Set<QueryRoute>(FIXTURES.map(f => classifyRoute(f.text)));
  routes.add("conversation");
  for (const route of routes) {
    const model = selectAutoModel(route, {});
    assert(model, `no model for route ${route}`);
    assert(MODELS.some(m => m.id === model.id), `route ${route} produced a non-catalog model ${model.id}`);
    // Text-only requests must keep context: the router may not hand back a
    // model that cannot hold an ordinary prompt.
    assert(model.context_length >= 8_000, `route ${route} produced a small-context model ${model.id}`);
  }
});

// ── benchmark ──────────────────────────────────────────────────────────────

Deno.test("benchmark: classifying a request-sized batch stays far below the per-request budget", () => {
  const texts = FIXTURES.map(f => f.text);
  const ITERATIONS = 10_000;
  const started = performance.now();
  let checksum = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    checksum += classifyRoute(texts[i % texts.length]).length;
  }
  const elapsedMs = performance.now() - started;
  assert(checksum > 0, "benchmark must actually run the classifier");
  // Measured in single-digit milliseconds locally; the 2s ceiling leaves
  // >100x headroom (so CI never flakes) while still catching an accidental
  // complexity regression in the scorer.
  assert(
    elapsedMs < 2000,
    `classifyRoute throughput regressed: ${ITERATIONS} calls took ${elapsedMs.toFixed(0)}ms`,
  );
  console.log(`[routing bench] ${ITERATIONS} classifications in ${elapsedMs.toFixed(1)}ms`);
});
