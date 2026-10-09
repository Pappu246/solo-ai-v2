/**
 * Retrieval evaluation fixtures (Phase 4).
 *
 * A fixed, deterministic corpus + query set that exercises the whole
 * pipeline — lexical, dense-adapter, scoping, budgets, diversity, empty
 * results — with ground-truth relevant chunk keys. Used by
 * `retrievalEval.test.ts` to *measure* precision / recall / hit-rate / MRR;
 * nothing here touches the network or a real model.
 */
import type { KnowledgeFile } from '../../types';
import type { RetrievedChunk } from './api';
import { chunkKey, localDenseRetriever, type DenseRetriever, type EmbeddingProvider } from './hybrid';
import { retrieveKnowledge, type RetrieveInput } from './retriever';

// ── corpus helpers ──────────────────────────────────────────────────────────

let fileSeq = 0;

export function makeFile(id: string, name: string, overrides: Partial<KnowledgeFile> = {}): KnowledgeFile {
  fileSeq += 1;
  return {
    id,
    user_id: 'user-1',
    project_id: null,
    conversation_id: null,
    name,
    mime_type: 'text/plain',
    size: 1024,
    storage_path: `user-1/${id}`,
    status: 'ready',
    error: null,
    chunk_count: 1,
    char_count: 0,
    preview: null,
    metadata: {},
    created_at: `2026-01-01T00:00:${String(fileSeq % 60).padStart(2, '0')}.000Z`,
    ...overrides,
  } as KnowledgeFile;
}

export function chunk(file: KnowledgeFile, chunk_index: number, content: string): RetrievedChunk {
  return { file_id: file.id, file_name: file.name, chunk_index, content, rank: 0 };
}

/**
 * Deterministic in-memory stand-in for `match_file_chunks`: scores in-scope
 * chunks by keyword occurrences and returns them best-first.
 */
export function inMemoryLexical(corpus: RetrievedChunk[]) {
  return async (keywords: string[], fileIds: string[], limit: number): Promise<RetrievedChunk[]> => {
    const scope = new Set(fileIds);
    return corpus
      .filter(c => scope.has(c.file_id))
      .map(c => {
        const content = ` ${c.content.toLowerCase()} `;
        const hits = keywords.filter(k => content.includes(` ${k}`) || content.includes(`${k} `)).length;
        return { c, hits };
      })
      .filter(x => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.c.file_id.localeCompare(b.c.file_id) || a.c.chunk_index - b.c.chunk_index)
      .slice(0, limit)
      .map((x, i) => ({ ...x.c, rank: 1 / (i + 1) }));
  };
}

/** Chunk lookup for the attached-file fallback, served from the corpus. */
export function inMemoryOpenings(corpus: RetrievedChunk[]) {
  return async (fileId: string, limit: number): Promise<Array<{ chunk_index: number; content: string }>> =>
    corpus
      .filter(c => c.file_id === fileId)
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .slice(0, limit)
      .map(c => ({ chunk_index: c.chunk_index, content: c.content }));
}

// ── a deterministic synonym-aware embedding (offline "semantic" adapter) ───

const SYNONYM_GROUPS: string[][] = [
  ['vehicle', 'automobile', 'car', 'auto'],
  ['purchase', 'buy', 'acquire'],
  ['deadline', 'due', 'timeline'],
  ['revenue', 'income', 'earnings'],
  ['launch', 'release', 'ship'],
];

/** Maps synonyms onto one shared dimension so "vehicle" ≈ "automobile". */
export class SynonymEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fixture-synonyms-v1';
  private readonly dims = 64;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => {
      const v = new Array<number>(this.dims).fill(0);
      const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (const word of words) {
        const group = SYNONYM_GROUPS.findIndex(g => g.includes(word));
        if (group >= 0) v[group] += 1;
        else v[SYNONYM_GROUPS.length + (word.charCodeAt(0) % (this.dims - SYNONYM_GROUPS.length))] += 0.3;
      }
      const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0));
      return norm > 0 ? v.map(x => x / norm) : v;
    });
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

export interface RetrievalFixture {
  name: string;
  query: string;
  /** Every chunk that exists, in any scope. */
  corpus: RetrievedChunk[];
  /** Files in scope for this chat (attached or in its project). */
  files: KnowledgeFile[];
  attachedFileIds?: string[];
  /** Ground truth: keys that SHOULD be retrieved for this query. */
  relevant: string[];
  /** Attach the synonym-aware dense adapter (hybrid path). */
  dense?: boolean;
  /** The pipeline must return no context at all. */
  expectEmpty?: boolean;
  charBudget?: number;
  maxChunks?: number;
  maxChunksPerFile?: number;
  /** Extra per-result assertions. */
  expect?: (keys: string[]) => void;
}

function buildFixtures(): RetrievalFixture[] {
  // 1 — exact keyword hit
  const finance = makeFile('f-finance', 'finance.csv');
  const financeCorpus = [
    chunk(finance, 0, 'Company overview and history.'),
    chunk(finance, 1, 'Quarterly revenue forecast for next year shows twelve percent growth driven by subscriptions.'),
    chunk(finance, 2, 'Hiring plan and headcount targets for the coming quarter.'),
  ];

  // 2 — synonym / semantic match (dense adapter only): the lexical stage
  // shares NO terms with "my vehicle needs service", so only the dense
  // adapter can surface this chunk.
  const cars = makeFile('f-cars', 'automobiles.txt');
  const carsCorpus = [
    chunk(cars, 0, 'The automobile parked in the garage requires fresh tires before winter.'),
  ];

  // 3 — irrelevant document
  const photosynthesisQuery = 'photosynthesis chloroplast sunlight';

  // 4 — multiple documents (plus a weak distractor that matches one term)
  const dbA = makeFile('f-db-a', 'db-guide-a.md');
  const dbB = makeFile('f-db-b', 'db-guide-b.md');
  const dbC = makeFile('f-db-c', 'db-guide-c.md');
  const dbNoise = makeFile('f-db-noise', 'db-guide-noise.md');
  const dbCorpus = [
    chunk(dbA, 0, 'Index tuning: add a composite index on (tenant_id, created_at) for the hot query path.'),
    chunk(dbB, 0, 'Index tuning: partial indexes keep the write path fast when most rows are filtered out.'),
    chunk(dbC, 0, 'Index tuning: cover the query with include columns to avoid heap lookups entirely.'),
    chunk(dbNoise, 0, 'The query planner chapter explains sequential scans in depth.'),
  ];

  // 5 — attached-file question ("summarise this")
  const attached = makeFile('f-attached', 'contract.pdf');
  const attachedCorpus = [
    chunk(attached, 0, 'Section 1. Parties and term: this agreement runs for twelve months.'),
    chunk(attached, 1, 'Section 2. Payment terms: net thirty days from invoice date.'),
    chunk(attached, 2, 'Section 3. Termination: either party may exit with thirty days notice.'),
  ];
  const bystander = makeFile('f-bystander', 'unrelated.md');
  const bystanderCorpus = [chunk(bystander, 0, 'Grocery list: milk, eggs, coffee.')];

  // 6 — project-scoped file
  const notes = makeFile('f-notes', 'meeting-notes.md');
  const notesCorpus = [
    chunk(notes, 0, 'Budget approval: the finance committee approved the infrastructure budget on Tuesday.'),
  ];

  // 7 — global file that must stay out of scope (checked for BOTH stages:
  // the dense adapter sees the whole corpus and must still not leak it)
  const outOfScope = makeFile('f-external', 'other-peoples-notes.md');
  const inScopeBudget = makeFile('f-budget', 'budget.md');
  const scopeCorpus = [
    chunk(inScopeBudget, 0, 'Infrastructure budget approval memo for the platform team.'),
    chunk(outOfScope, 0, 'Budget approval notes owned by a different workspace entirely.'),
  ];

  // 8 — empty retrieval
  const sparse = makeFile('f-sparse', 'sparse.txt');
  const sparseCorpus = [chunk(sparse, 0, 'Nothing relevant to greetings lives in this file at all.')];

  // 9 — conflicting documents
  const roadmapA = makeFile('f-roadmap-a', 'roadmap-a.md');
  const roadmapB = makeFile('f-roadmap-b', 'roadmap-b.md');
  const conflictCorpus = [
    chunk(roadmapA, 1, 'The launch deadline is Friday according to the product team.'),
    chunk(roadmapB, 1, 'The launch deadline is Monday according to the engineering team.'),
  ];

  // 10 — large file with a relevant chunk buried deep
  const big = makeFile('f-big', 'handbook.txt');
  const bigCorpus: RetrievedChunk[] = [];
  for (let i = 0; i < 40; i++) {
    bigCorpus.push(chunk(big, i, i === 30
      ? 'Parental leave policy: sixteen weeks of paid leave for new parents.'
      : `Generic handbook paragraph ${i} about office etiquette and other routine matters with no query terms.`));
  }

  // 11 — long context under a tight budget
  const longA = makeFile('f-long-a', 'long-a.txt');
  const longB = makeFile('f-long-b', 'long-b.txt');
  const longCorpus = [
    chunk(longA, 0, 'Deployment runbook rollback strategy part one. '.repeat(9)),
    chunk(longA, 1, 'Deployment runbook rollback strategy part two. '.repeat(9)),
    chunk(longB, 0, 'Deployment runbook rollback strategy part three. '.repeat(9)),
  ];

  return [
    {
      name: 'exact keyword hit',
      query: 'What is the quarterly revenue forecast?',
      corpus: financeCorpus,
      files: [finance],
      relevant: [chunkKey(financeCorpus[1])],
      expect: keys => {
        if (keys[0] !== chunkKey(financeCorpus[1])) throw new Error(`expected the forecast chunk first, got ${keys[0]}`);
      },
    },
    {
      name: 'synonym match via the dense adapter',
      query: 'my vehicle needs service',
      corpus: carsCorpus,
      files: [cars],
      relevant: [chunkKey(carsCorpus[0])],
      dense: true,
    },
    {
      name: 'irrelevant document yields no context',
      query: photosynthesisQuery,
      corpus: [...financeCorpus, ...carsCorpus],
      files: [finance, cars],
      relevant: [],
      expectEmpty: true,
    },
    {
      name: 'multiple documents are all surfaced',
      query: 'index tuning for the hot query',
      corpus: dbCorpus,
      files: [dbA, dbB, dbC, dbNoise],
      relevant: [chunkKey(dbCorpus[0]), chunkKey(dbCorpus[1]), chunkKey(dbCorpus[2])],
    },
    {
      name: 'attached-file question falls back to its opening',
      query: 'summarise this',
      corpus: [...attachedCorpus, ...bystanderCorpus],
      files: [attached, bystander],
      attachedFileIds: [attached.id],
      relevant: attachedCorpus.map(c => chunkKey(c)),
      expect: keys => {
        if (keys.some(k => k.startsWith(bystander.id))) throw new Error('the bystander file must not be pulled in');
      },
    },
    {
      name: 'project-scoped file is searched',
      query: 'budget approval meeting notes',
      corpus: notesCorpus,
      files: [notes],
      relevant: [chunkKey(notesCorpus[0])],
    },
    {
      name: 'global file outside the scope is never retrieved',
      query: 'budget approval',
      corpus: scopeCorpus,
      files: [inScopeBudget], // the other file exists but is not in this chat's scope
      relevant: [chunkKey(scopeCorpus[0])],
      dense: true, // exercise scope filtering on the dense path too
      expect: keys => {
        if (keys.some(k => k.startsWith(outOfScope.id))) throw new Error('out-of-scope file leaked into retrieval');
      },
    },
    {
      name: 'no keywords and no attachment → no context',
      query: 'hello there',
      corpus: sparseCorpus,
      files: [sparse],
      relevant: [],
      expectEmpty: true,
    },
    {
      name: 'conflicting documents both surface for reconciliation',
      query: 'when is the launch deadline',
      corpus: conflictCorpus,
      files: [roadmapA, roadmapB],
      relevant: conflictCorpus.map(c => chunkKey(c)),
      expect: keys => {
        const files = new Set(keys.map(k => k.split(':')[0]));
        if (files.size < 2) throw new Error('both conflicting sources must be represented');
      },
    },
    {
      name: 'large file: buried chunk is found within budget',
      query: 'parental leave policy',
      corpus: bigCorpus,
      files: [big],
      relevant: [chunkKey(bigCorpus[30])],
      charBudget: 2_000,
    },
    {
      name: 'long context respects the budget and chunk cap',
      query: 'deployment runbook rollback',
      corpus: longCorpus,
      files: [longA, longB],
      // Budget: 1000 chars with 423-char chunks — the per-file share (60%)
      // plus the chunk cap must bound the result; ground truth is the
      // top-ranked chunk that fits.
      relevant: [chunkKey(longCorpus[0])],
      charBudget: 1000,
      maxChunks: 2,
    },
  ];
}

export const RETRIEVAL_FIXTURES: RetrievalFixture[] = buildFixtures();

// ── runner ──────────────────────────────────────────────────────────────────

export interface FixtureResult {
  fixture: RetrievalFixture;
  keys: string[];
  totalChars: number;
}

export function fixtureDense(fixture: RetrievalFixture): DenseRetriever | null {
  return fixture.dense ? localDenseRetriever(fixture.corpus, new SynonymEmbeddingProvider()) : null;
}

export async function runFixture(fixture: RetrievalFixture): Promise<FixtureResult> {
  const input: RetrieveInput = {
    query: fixture.query,
    files: fixture.files,
    attachedFileIds: fixture.attachedFileIds,
    charBudget: fixture.charBudget,
    maxChunks: fixture.maxChunks,
    maxChunksPerFile: fixture.maxChunksPerFile,
    denseSearch: fixtureDense(fixture),
    lexicalSearch: inMemoryLexical(fixture.corpus),
    listChunks: inMemoryOpenings(fixture.corpus),
  };
  const result = await retrieveKnowledge(input);
  return {
    fixture,
    keys: result.chunks.map(chunkKey),
    totalChars: result.chunks.reduce((n, c) => n + c.content.length, 0),
  };
}
