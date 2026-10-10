/**
 * Hybrid retrieval pipeline stages (Phase 4).
 *
 *   QUERY → normalize → lexical retrieval → optional dense retrieval
 *         → merge (reciprocal rank fusion) → rerank → source diversity /
 *           duplicate suppression → context budget → model
 *
 * Every stage is a pure, dependency-free function so the pipeline is
 * deterministic and testable offline. Adapters (`EmbeddingProvider`,
 * `DenseRetriever`) are OPTIONAL: the default path is lexical-only, which is
 * what production uses today. Nothing here talks to the network.
 *
 * This module deliberately does NOT import `./retriever` or `./api`
 * (one-directional dependency: retriever → hybrid).
 */

// ── Shared chunk shape ──────────────────────────────────────────────────────

/** Structural chunk shape shared with `RetrievedChunk` (api.ts). */
export interface RankedChunk {
  file_id: string;
  file_name: string;
  chunk_index: number;
  content: string;
  rank: number;
}

// ── Stage 1: query normalization ───────────────────────────────────────────

/**
 * Collapse equivalent query forms so they behave identically:
 * case, Unicode compatibility forms, punctuation and repeated whitespace.
 */
export function normalizeQuery(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Deduplicated content terms of a query (order preserved, capped). */
export function terms(input: string, max = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of normalizeQuery(input).split(' ')) {
    if (word.length < 3 || word.length > 40 || /^\d+$/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

// ── Stage 2: optional dense retrieval (adapters) ───────────────────────────

/** Configurable embedding backend. Production may leave this unset. */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Corpus-level dense search adapter (ranked by descending similarity). */
export interface DenseRetriever {
  readonly name: string;
  /** Returns the best matching chunks (from its own corpus) with scores. */
  search(query: string, fileIds: string[], limit: number): Promise<Array<{ chunk: RankedChunk; score: number }>>;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Free, local, deterministic embedding: signed feature hashing over word
 * tokens and character trigrams. It is NOT a semantic model — it adds a
 * fuzzy morphology signal (typos, inflections, compounds) with zero
 * dependencies, and serves as the offline baseline for the adapter path.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local-hash-v1';
  constructor(private readonly dims = 256) {}

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map(text => this.vector(text)));
  }

  vector(text: string): number[] {
    const v = new Array<number>(this.dims).fill(0);
    const normalized = ` ${normalizeQuery(text)} `;
    const push = (feature: string) => {
      const hash = fnv1a(feature);
      const index = hash % this.dims;
      const sign = (hash >>> 9) & 1 ? 1 : -1;
      v[index] += sign;
    };
    for (const word of normalized.split(' ').filter(Boolean)) {
      push(`w:${word}`);
      const padded = `^${word}$`;
      for (let i = 0; i + 3 <= padded.length; i++) push(padded.slice(i, i + 3));
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }
}

/**
 * In-memory dense retriever over a known chunk corpus — the shape a real
 * dense backend would implement. Deterministic with any injected provider.
 */
export function localDenseRetriever(corpus: RankedChunk[], provider: EmbeddingProvider = new HashingEmbeddingProvider()): DenseRetriever {
  let index: Array<{ key: string; file_id: string; index: number; vector: number[] }> | null = null;
  const ensure = async () => {
    if (index) return index;
    const vectors = await provider.embed(corpus.map(c => c.content));
    index = corpus.map((c, i) => ({ key: `${c.file_id}:${c.chunk_index}`, file_id: c.file_id, index: i, vector: vectors[i] }));
    return index;
  };
  return {
    name: `local:${provider.name}`,
    async search(query, fileIds, limit) {
      const scope = new Set(fileIds);
      const rows = await ensure();
      const qv = (await provider.embed([query]))[0];
      return rows
        .filter(row => scope.has(row.file_id))
        .map(row => ({ chunk: corpus[row.index], score: cosine(qv, row.vector) }))
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score || chunkKey(a.chunk).localeCompare(chunkKey(b.chunk)))
        .slice(0, limit);
    },
  };
}

// ── Stage 3: merge (reciprocal rank fusion) ────────────────────────────────

export interface RankList<T> {
  items: T[];
  /** Higher weight = trust this source more. Default 1. */
  weight?: number;
}

/**
 * Reciprocal Rank Fusion over ranked lists. Rank-blind and scale-free, so a
 * FTS score and a cosine score can be merged without calibration.
 * Returns key → fused score (higher is better).
 */
export function reciprocalRankFusion<T>(
  lists: Array<RankList<T>>,
  keyOf: (item: T) => string,
  k = 60,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.items.forEach((item, index) => {
      const key = keyOf(item);
      fused.set(key, (fused.get(key) ?? 0) + weight / (k + index + 1));
    });
  }
  return fused;
}

export const chunkKey = (c: { file_id: string; chunk_index: number }): string => `${c.file_id}:${c.chunk_index}`;

export function keyToParts(key: string): { file_id: string; chunk_index: number } {
  const at = key.lastIndexOf(':');
  return { file_id: key.slice(0, at), chunk_index: Number(key.slice(at + 1)) };
}

// ── Stage 4: reranking ─────────────────────────────────────────────────────

export interface RerankScore {
  /** 0..1 combined score. */
  score: number;
  /** Fraction of query terms present in the chunk. */
  coverage: number;
  /** True when the normalized query appears verbatim in the chunk. */
  phrase: boolean;
}

/**
 * Free, deterministic reranker: blends the source rank (FTS or fused) with
 * query-term coverage and a verbatim-phrase bonus. No model required.
 */
export function rerankScore(query: string, chunk: RankedChunk, sourceRank: number): RerankScore {
  const q = terms(query);
  const chunkTerms = new Set(terms(chunk.content, 200));
  const hits = q.filter(t => chunkTerms.has(t)).length;
  const coverage = q.length ? hits / q.length : 0;
  const normalizedQuery = normalizeQuery(query);
  const phrase = normalizedQuery.length >= 8 && normalizeQuery(chunk.content).includes(normalizedQuery);
  const score = Math.min(1, 0.5 * Math.max(0, Math.min(1, sourceRank)) + 0.45 * coverage + (phrase ? 0.25 : 0));
  return { score, coverage, phrase };
}

/**
 * Rerank a candidate list. `sourceRank` is the (already normalized 0..1)
 * fused/source rank; the result keeps the same T shape with `rank` set to
 * the blended score, sorted best-first.
 */
export function rerankChunks<T extends RankedChunk>(query: string, chunks: T[]): T[] {
  return chunks
    .map(chunk => ({ chunk, scored: rerankScore(query, chunk, chunk.rank) }))
    .sort((a, b) => b.scored.score - a.scored.score || a.chunk.chunk_index - b.chunk.chunk_index)
    .map(({ chunk, scored }) => ({ ...chunk, rank: scored.score }));
}

// ── Stage 5: source diversity & duplicate suppression ──────────────────────

function normalized(content: string): string {
  return normalizeQuery(content);
}

/**
 * Drop near-duplicate chunks: identical normalized text, or one chunk
 * almost entirely contained in another (≥ 90% of its length). Keeps the
 * first (highest-ranked) occurrence.
 */
export function dedupeChunks<T extends RankedChunk>(chunks: T[]): T[] {
  const kept: T[] = [];
  const keptNormalized: string[] = [];
  for (const chunk of chunks) {
    const text = normalized(chunk.content);
    let duplicate = false;
    for (let i = 0; i < keptNormalized.length; i++) {
      const other = keptNormalized[i];
      if (other === text) { duplicate = true; break; }
      const [short, long] = other.length <= text.length ? [other, text] : [text, other];
      if (short.length >= 40 && long.includes(short) && short.length / long.length >= 0.9) { duplicate = true; break; }
    }
    if (!duplicate) {
      kept.push(chunk);
      keptNormalized.push(text);
    }
  }
  return kept;
}

export interface DiversityOptions {
  /** Max chunks per non-attached file. Attached files are exempt. */
  maxPerFile?: number;
  attachedFileIds?: Iterable<string>;
}

/**
 * Enforce source diversity: after the top-ranked chunk of each file, no
 * non-attached file may dominate the candidate list. Applied after rerank,
 * before the context budget.
 */
export function enforceSourceDiversity<T extends RankedChunk>(chunks: T[], options: DiversityOptions = {}): T[] {
  const maxPerFile = options.maxPerFile ?? 3;
  const attached = new Set(options.attachedFileIds ?? []);
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const chunk of chunks) {
    if (attached.has(chunk.file_id)) { out.push(chunk); continue; }
    const count = counts.get(chunk.file_id) ?? 0;
    if (count >= maxPerFile) continue;
    counts.set(chunk.file_id, count + 1);
    out.push(chunk);
  }
  return out;
}
