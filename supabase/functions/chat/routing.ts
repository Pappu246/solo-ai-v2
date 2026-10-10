/**
 * Query → route classification for Auto routing (Phase 16).
 *
 * Extracted verbatim from `index.ts` so the classifier that decides where
 * every Auto-routed message goes can be evaluated offline — see
 * `routing_test.ts`, which measures its accuracy on labelled queries.
 *
 * The classifier is a deterministic substring scorer, not a language model:
 * every keyword found in the lower-cased query contributes its length to its
 * category's score, the highest score wins, ties keep declaration order
 * (coding → reasoning → research → fast), and an all-zero score falls back to
 * "conversation". Note that matching is by substring, so words like "decode"
 * score for coding ("code") — the eval suite documents that behaviour rather
 * than hiding it.
 */

export type QueryRoute = "conversation" | "coding" | "reasoning" | "research" | "fast";

export const ROUTE_KEYWORDS: Record<Exclude<QueryRoute, "conversation">, readonly string[]> = {
  coding: ["code", "debug", "typescript", "javascript", "python", "react", "sql", "api", "algorithm"],
  reasoning: ["explain", "analyze", "logic", "math", "calculate", "proof", "solve", "strategy", "compare"],
  research: ["research", "latest", "news", "search", "find", "history", "facts", "report", "study", "paper"],
  fast: ["quick", "brief", "short", "simple", "translate", "summarize"],
};

/** Classify a user message into the Auto-routing category it asks for. */
export function classifyRoute(text: string): QueryRoute {
  const s = text.toLowerCase();
  let best: QueryRoute = "conversation";
  let bestScore = 0;
  for (const route of Object.keys(ROUTE_KEYWORDS) as Array<Exclude<QueryRoute, "conversation">>) {
    const score = ROUTE_KEYWORDS[route].reduce((x, q) => x + (s.includes(q) ? q.length : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = route;
    }
  }
  return best;
}
