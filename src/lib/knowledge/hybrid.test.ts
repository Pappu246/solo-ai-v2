/**
 * Unit tests for the hybrid retrieval pipeline stages (Phase 4).
 * Fully offline and deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  chunkKey,
  dedupeChunks,
  enforceSourceDiversity,
  HashingEmbeddingProvider,
  localDenseRetriever,
  normalizeQuery,
  reciprocalRankFusion,
  rerankChunks,
  rerankScore,
  terms,
  cosine,
  type RankedChunk,
} from './hybrid';

const chunk = (file_id: string, chunk_index: number, content: string, rank = 0): RankedChunk =>
  ({ file_id, file_name: `${file_id}.txt`, chunk_index, content, rank });

describe('query normalization', () => {
  it('collapses case, punctuation, whitespace and Unicode forms', () => {
    expect(normalizeQuery('  QuarterLY   REVENUE!! ')).toBe('quarterly revenue');
    expect(normalizeQuery('Ｑuery:  HTTP  status')).toBe('query http status');
    expect(normalizeQuery('café — résumé')).toBe('café résumé');
  });

  it('produces identical normalized forms for equivalent queries', () => {
    expect(normalizeQuery('Index   Tuning')).toBe(normalizeQuery('index tuning'));
    expect(terms('index tuning')).toEqual(terms('  INDEX   tuning!! '));
  });

  it('deduplicates terms and drops numeric-only tokens', () => {
    expect(terms('index index tuning 2024')).toEqual(['index', 'tuning']);
    expect(terms('a to of')).toEqual([]);
  });
});

describe('embeddings (local, free, deterministic)', () => {
  it('is deterministic for identical input', async () => {
    const provider = new HashingEmbeddingProvider();
    const [a] = await provider.embed(['the quarterly revenue forecast']);
    const [b] = await provider.embed(['the quarterly revenue forecast']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(256);
  });

  it('scores morphological variants closer than unrelated text', async () => {
    const provider = new HashingEmbeddingProvider();
    const [base, inflection, unrelated] = await provider.embed([
      'deploy the service',
      'deploying the service',
      'banana bread recipe',
    ]);
    expect(cosine(base, inflection)).toBeGreaterThan(cosine(base, unrelated));
    expect(cosine(base, base)).toBeCloseTo(1, 5);
  });

  it('exposes a dense retriever that respects the file scope', async () => {
    const corpus = [
      chunk('a', 0, 'deployment rollback steps for the service'),
      chunk('b', 0, 'deployment rollback steps for the other service'),
      chunk('c', 0, 'gardening tips for tomatoes'),
    ];
    const dense = localDenseRetriever(corpus, new HashingEmbeddingProvider());
    const hits = await dense.search('deployment rollback', ['a'], 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.chunk.file_id === 'a')).toBe(true);
    expect(hits[0].score).toBeGreaterThan(0);
    // Scores descend.
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });
});

describe('rank fusion', () => {
  it('promotes items that appear in multiple lists', () => {
    const listA = ['a1', 'a2', 'shared'];
    const listB = ['shared', 'b1'];
    const fused = reciprocalRankFusion([{ items: listA }, { items: listB }], (x: string) => x);
    const ranked = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
    expect(ranked[0]).toBe('shared'); // rank 3 + rank 1 beats rank 1 alone
    expect(fused.get('a1')).toBeCloseTo(1 / 61, 10); // single-list rank 1
    expect(fused.get('shared')).toBeCloseTo(1 / 63 + 1 / 61, 10); // rank 3 + rank 1
  });

  it('honours source weights', () => {
    const fused = reciprocalRankFusion(
      [{ items: ['lexical-first'], weight: 2 }, { items: ['dense-first'] }],
      (x: string) => x,
    );
    expect(fused.get('lexical-first')).toBeGreaterThan(fused.get('dense-first') ?? 0);
  });
});

describe('reranking', () => {
  it('prefers chunks that cover more of the query', () => {
    const low = chunk('a', 0, 'nothing about the question at all here', 0.5);
    const high = chunk('a', 1, 'index tuning keeps the hot query fast', 0.5);
    const ranked = rerankChunks('index tuning hot query', [low, high]);
    expect(ranked[0].chunk_index).toBe(1);
    expect(ranked[0].rank).toBeGreaterThan(ranked[1].rank);
  });

  it('adds a bonus for a verbatim phrase match', () => {
    const phrase = rerankScore('parental leave policy', chunk('a', 0, 'Parental leave policy: sixteen weeks of paid leave.'), 0.2);
    const partial = rerankScore('parental leave policy', chunk('a', 1, 'Leave policies vary by region and parental status.'), 0.2);
    expect(phrase.phrase).toBe(true);
    expect(phrase.score).toBeGreaterThan(partial.score);
  });

  it('keeps source rank in the blend (a strong FTS hit is not buried)', () => {
    const strongSource = rerankScore('alpha beta', chunk('a', 0, 'alpha beta gamma delta'), 1);
    const weakSource = rerankScore('alpha beta', chunk('a', 1, 'alpha beta gamma delta'), 0.1);
    expect(strongSource.score).toBeGreaterThan(weakSource.score);
  });
});

describe('diversity & duplicate suppression', () => {
  it('suppresses identical and near-contained duplicates, keeping the top-ranked copy', () => {
    const original = chunk('a', 0, 'The launch deadline is Friday according to the product team.');
    const duplicate = chunk('b', 4, 'the launch deadline is Friday according to the product team!');
    const unrelated = chunk('c', 0, 'A completely different sentence about lunch menus.');
    const kept = dedupeChunks([original, duplicate, unrelated]);
    expect(kept.map(c => `${c.file_id}:${c.chunk_index}`)).toEqual(['a:0', 'c:0']);
  });

  it('keeps chunks that merely share a topic', () => {
    const a = chunk('a', 0, 'The launch deadline is Friday according to the product team.');
    const b = chunk('b', 0, 'The launch deadline is Monday according to the engineering team.');
    expect(dedupeChunks([a, b])).toHaveLength(2);
  });

  it('caps non-attached files but never the attached one', () => {
    const input = [
      chunk('a', 0, 'one', 1),
      chunk('a', 1, 'two', 0.9),
      chunk('a', 2, 'three', 0.8),
      chunk('a', 3, 'four', 0.7),
      chunk('b', 0, 'attached-1', 0.6),
      chunk('b', 1, 'attached-2', 0.5),
    ];
    const out = enforceSourceDiversity(input, { maxPerFile: 3, attachedFileIds: ['b'] });
    expect(out.map(c => chunkKey(c))).toEqual(['a:0', 'a:1', 'a:2', 'b:0', 'b:1']);
    // Without an attached exemption the cap applies to every file.
    const strict = enforceSourceDiversity(input, { maxPerFile: 1 });
    expect(strict).toHaveLength(2);
  });
});
