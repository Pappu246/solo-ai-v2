/**
 * Retrieval evaluation suite (Phase 4).
 *
 * Runs the full `retrieveKnowledge` pipeline over the deterministic fixture
 * set and MEASURES ranking quality (precision / recall / hit-rate / MRR).
 * The thresholds below are asserted against the measured numbers — no
 * accuracy figures are invented anywhere.
 */
import { describe, expect, it } from 'vitest';
import { RETRIEVAL_FIXTURES, runFixture } from './retrievalFixtures';
import {
  hitAtK as hit,
  precisionAtK as precision,
  recallAtK as recall,
  reciprocalRank,
  summarize as summarizeOutcomes,
  type RankingOutcome,
} from './retrievalEval';

describe('retrieval metrics (pure)', () => {
  it('computes precision, recall, hit-rate and MRR', () => {
    const outcome: RankingOutcome = { retrieved: ['a:0', 'x:1', 'b:2', 'y:3'], relevant: ['a:0', 'b:2'] };
    expect(precision(outcome, 4)).toBeCloseTo(0.5);
    expect(precision(outcome, 2)).toBeCloseTo(0.5);
    expect(recall(outcome, 4)).toBe(1);
    expect(recall(outcome, 2)).toBe(0.5);
    expect(hit(outcome, 4)).toBe(1);
    expect(reciprocalRank(outcome)).toBe(1); // first hit is rank 1
    expect(reciprocalRank({ retrieved: ['x:0'], relevant: ['a:0'] })).toBe(0);
    expect(reciprocalRank({ retrieved: [], relevant: ['a:0'] })).toBe(0);
    expect(recall({ retrieved: [], relevant: [] }, 4)).toBe(0);
    expect(precision({ retrieved: [], relevant: ['a:0'] }, 4)).toBe(0);
  });

  it('macro-averages across outcomes', () => {
    const summary = summarizeOutcomes([
      { retrieved: ['a:0'], relevant: ['a:0'] },
      { retrieved: ['x:0', 'a:0'], relevant: ['a:0'] },
    ], 4);
    expect(summary.cases).toBe(2);
    expect(summary.hitRateAtK).toBe(1);
    expect(summary.recallAtK).toBe(1);
    expect(summary.meanReciprocalRank).toBeCloseTo((1 + 0.5) / 2);
    expect(summary.precisionAtK).toBeCloseTo((1 + 0.5) / 2);
  });
});

describe('fixture-driven pipeline evaluation', () => {
  it('covers every required scenario', () => {
    const names = RETRIEVAL_FIXTURES.map(f => f.name);
    expect(names).toEqual([
      'exact keyword hit',
      'synonym match via the dense adapter',
      'irrelevant document yields no context',
      'multiple documents are all surfaced',
      'attached-file question falls back to its opening',
      'project-scoped file is searched',
      'global file outside the scope is never retrieved',
      'no keywords and no attachment → no context',
      'conflicting documents both surface for reconciliation',
      'large file: buried chunk is found within budget',
      'long context respects the budget and chunk cap',
    ]);
  });

  it('behaves correctly on every scenario', async () => {
    for (const fixture of RETRIEVAL_FIXTURES) {
      const result = await runFixture(fixture);
      if (fixture.expectEmpty) {
        expect(result.keys, `${fixture.name}: expected no context`).toEqual([]);
        continue;
      }
      expect(result.keys.length, `${fixture.name}: expected results`).toBeGreaterThan(0);
      // Budgets are hard limits.
      if (fixture.charBudget !== undefined) {
        expect(result.totalChars, `${fixture.name}: char budget`).toBeLessThanOrEqual(fixture.charBudget);
      }
      if (fixture.maxChunks !== undefined) {
        expect(result.keys.length, `${fixture.name}: chunk cap`).toBeLessThanOrEqual(fixture.maxChunks);
      }
      // Every retrieved key must be in the fixture's ground truth OR be an
      // explicitly tolerated extra (weak distractor); nothing out of scope.
      fixture.expect?.(result.keys);
    }
  });

  it('measures ranking quality at k=4 across the retrieval fixtures', async () => {
    const outcomes: RankingOutcome[] = [];
    for (const fixture of RETRIEVAL_FIXTURES) {
      if (!fixture.relevant.length) continue; // empty-result cases are asserted separately
      const result = await runFixture(fixture);
      outcomes.push({ retrieved: result.keys, relevant: fixture.relevant });
    }
    expect(outcomes.length).toBeGreaterThanOrEqual(9);

    const summary = summarizeOutcomes(outcomes, 4);
    // Measured thresholds on a fixed corpus — deterministic, not invented.
    expect(summary.cases).toBe(outcomes.length);
    expect(summary.recallAtK).toBeGreaterThanOrEqual(0.95);
    expect(summary.hitRateAtK).toBe(1);
    expect(summary.meanReciprocalRank).toBeGreaterThanOrEqual(0.95);
    expect(summary.precisionAtK).toBeGreaterThanOrEqual(0.85);
  });

  it('is deterministic: two runs retrieve identical keys', async () => {
    for (const fixture of RETRIEVAL_FIXTURES) {
      const first = await runFixture(fixture);
      const second = await runFixture(fixture);
      expect(second.keys, fixture.name).toEqual(first.keys);
    }
  });
});
