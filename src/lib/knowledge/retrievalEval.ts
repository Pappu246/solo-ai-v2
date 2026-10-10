/**
 * Retrieval evaluation metrics (Phase 4).
 *
 * Pure, deterministic functions over fixture results — no network, no
 * randomness. Used by `retrievalEval.test.ts` to *measure* ranking quality
 * on a fixed fixture set; the tests assert the measured values, they do not
 * invent accuracy numbers.
 */

export interface RankingOutcome {
  /** Retrieved chunk keys in rank order (`file_id:chunk_index`). */
  retrieved: string[];
  /** Ground-truth relevant chunk keys for the query. */
  relevant: string[];
}

/** Fraction of the top-k retrieved items that are relevant. */
export function precisionAtK(outcome: RankingOutcome, k: number): number {
  const top = outcome.retrieved.slice(0, k);
  if (!top.length) return 0;
  const relevant = new Set(outcome.relevant);
  return top.filter(id => relevant.has(id)).length / top.length;
}

/** Fraction of the relevant items found in the top k. */
export function recallAtK(outcome: RankingOutcome, k: number): number {
  if (!outcome.relevant.length) return 0;
  const top = new Set(outcome.retrieved.slice(0, k));
  return outcome.relevant.filter(id => top.has(id)).length / outcome.relevant.length;
}

/** 1 when at least one relevant item appears in the top k, else 0. */
export function hitAtK(outcome: RankingOutcome, k: number): number {
  const relevant = new Set(outcome.relevant);
  return outcome.retrieved.slice(0, k).some(id => relevant.has(id)) ? 1 : 0;
}

/** Reciprocal rank of the first relevant item (0 when none is found). */
export function reciprocalRank(outcome: RankingOutcome): number {
  const relevant = new Set(outcome.relevant);
  const index = outcome.retrieved.findIndex(id => relevant.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export interface EvalSummary {
  cases: number;
  precisionAtK: number;
  recallAtK: number;
  hitRateAtK: number;
  meanReciprocalRank: number;
}

/** Macro-average each metric across outcomes at a fixed k. */
export function summarize(outcomes: RankingOutcome[], k: number): EvalSummary {
  if (!outcomes.length) return { cases: 0, precisionAtK: 0, recallAtK: 0, hitRateAtK: 0, meanReciprocalRank: 0 };
  const mean = (fn: (o: RankingOutcome) => number) =>
    outcomes.reduce((sum, o) => sum + fn(o), 0) / outcomes.length;
  return {
    cases: outcomes.length,
    precisionAtK: mean(o => precisionAtK(o, k)),
    recallAtK: mean(o => recallAtK(o, k)),
    hitRateAtK: mean(o => hitAtK(o, k)),
    meanReciprocalRank: mean(o => reciprocalRank(o)),
  };
}
