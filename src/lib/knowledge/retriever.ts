/**
 * KnowledgeRetriever — decides *what* context accompanies a chat turn.
 *
 *   1. Which files are in scope? (attached to this chat, or in its project)
 *   2. Which chunks of those files are relevant to the user's question?
 *   3. Which memories apply? (global + this project, highest importance first)
 *   4. Trim everything to a context budget, keeping source information.
 *
 * Nothing here talks to the model; it produces a `ChatContext` that
 * `lib/chat/stream.ts` forwards to the Edge Function.
 */
import type { ChatContext, KnowledgeFile, KnowledgeSource, Memory, Project } from '../../types';
import { chunksApi, type RetrievedChunk } from './api';
import {
  chunkKey,
  dedupeChunks,
  enforceSourceDiversity,
  reciprocalRankFusion,
  rerankChunks,
  type DenseRetriever,
} from './hybrid';

/** Total characters of file excerpts sent with one request. */
export const KNOWLEDGE_CHAR_BUDGET = 12_000;
/** Maximum chunks per request, regardless of budget. */
export const KNOWLEDGE_MAX_CHUNKS = 8;
/** Never spend more than this share of the budget on a single file. */
const PER_FILE_SHARE = 0.6;
/** Characters of memories sent with one request. */
export const MEMORY_CHAR_BUDGET = 2_000;
export const MEMORY_MAX_ITEMS = 12;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with',
  'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before',
  'under', 'around', 'among', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has',
  'had', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'she', 'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'what', 'which', 'who',
  'whom', 'how', 'when', 'where', 'why', 'not', 'no', 'yes', 'please', 'tell', 'give', 'show', 'explain', 'summarize',
  'summarise', 'describe', 'file', 'document', 'doc', 'pdf', 'text', 'content', 'say', 'says', 'said', 'mean', 'means',
  'thing', 'things', 'some', 'any', 'all', 'more', 'most', 'much', 'many', 'just', 'also', 'very', 'there', 'here',
  'get', 'got', 'make', 'made', 'know', 'think', 'want', 'need', 'use', 'using', 'used', 'one', 'two', 'up', 'down',
]);

/** Keywords worth searching for. Empty when the message carries no real signal. */
export function extractKeywords(text: string, max = 12): string[] {
  const seen = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[`*_>#~]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u);
  for (const w of words) {
    if (w.length >= 3 && w.length <= 40 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) {
      seen.add(w);
      if (seen.size >= max) break;
    }
  }
  return [...seen];
}

/** True when the user is clearly talking about their files rather than asking a general question. */
export function mentionsFiles(text: string): boolean {
  return /\b(file|files|document|documents|doc|docs|pdf|attachment|attached|upload|uploaded|spreadsheet|csv|notes|report)\b/i.test(text);
}

export interface RetrieveInput {
  query: string;
  /** Files available to this chat (already filtered to the caller's own). */
  files: KnowledgeFile[];
  /** Ids of files explicitly attached to the current message; these win ties. */
  attachedFileIds?: string[];
  charBudget?: number;
  maxChunks?: number;
  /**
   * Optional dense-retrieval adapter (Phase 4 hybrid pipeline). Unset =
   * lexical-only, which is the production default. Failures degrade to
   * lexical retrieval — dense is never required for basic operation.
   */
  denseSearch?: DenseRetriever | null;
  /** Injection seam for offline evaluation/tests; defaults to `chunksApi.match`. */
  lexicalSearch?: (keywords: string[], fileIds: string[], limit: number) => Promise<RetrievedChunk[]>;
  /** Injection seam for the attached-file opening fallback; defaults to `chunksApi.listForFile`. */
  listChunks?: (fileId: string, limit: number) => Promise<Array<{ chunk_index: number; content: string }>>;
  /** Diversity cap per non-attached file (default 3; ignored for a single source). */
  maxChunksPerFile?: number;
}

export interface RetrievedKnowledge {
  chunks: RetrievedChunk[];
  sources: KnowledgeSource[];
}

/**
 * Select relevant chunks for `query` from `files`. Only `ready` files are
 * searched. Returns an empty result when nothing is relevant — the caller
 * must then send *no* file context rather than "all files".
 *
 * Pipeline: normalize → lexical → optional dense → RRF merge → rerank →
 * source diversity / dedup → context budget (see `./hybrid.ts`).
 */
export async function retrieveKnowledge(input: RetrieveInput): Promise<RetrievedKnowledge> {
  const ready = input.files.filter(f => f.status === 'ready');
  if (!ready.length) return { chunks: [], sources: [] };

  const budget = input.charBudget ?? KNOWLEDGE_CHAR_BUDGET;
  const maxChunks = input.maxChunks ?? KNOWLEDGE_MAX_CHUNKS;
  const attached = new Set(input.attachedFileIds ?? []);
  const keywords = extractKeywords(input.query);
  const fileIds = ready.map(f => f.id);
  const candidateLimit = Math.max(maxChunks * 3, 24);
  const lexicalSearch = input.lexicalSearch ?? ((kw, ids, limit) => chunksApi.match(kw, ids, limit));

  // Stage: lexical retrieval.
  let lexical: RetrievedChunk[] = [];
  if (keywords.length) {
    try {
      lexical = await lexicalSearch(keywords, fileIds, candidateLimit);
    } catch {
      lexical = []; // a failed lexical query must not throw away the fallbacks below
    }
  }

  // Stage: optional dense retrieval — adapter failures degrade to lexical.
  let dense: RetrievedChunk[] = [];
  if (input.denseSearch && keywords.length) {
    try {
      const hits = await input.denseSearch.search(input.query, fileIds, candidateLimit);
      dense = hits
        .filter(h => h.chunk && typeof h.score === 'number')
        .map(h => ({ ...h.chunk, rank: h.score }))
        .filter(c => ready.some(f => f.id === c.file_id)); // never escape the scope
    } catch {
      dense = [];
    }
  }

  // A file the user just attached is relevant by definition: any attached
  // file that neither stage covered (e.g. "summarise this", or a second
  // attachment the keywords missed) falls back to its opening chunks.
  const attachedReady = ready.filter(f => attached.has(f.id));
  const covered = new Set([...lexical, ...dense].map(c => c.file_id));
  const uncovered = attachedReady.filter(f => !covered.has(f.id));
  const openingCandidates: RetrievedChunk[] = [];
  if (uncovered.length) {
    const listChunks = input.listChunks ?? ((fileId: string, limit: number) => chunksApi.listForFile(fileId, limit));
    const openings = await Promise.all(uncovered.map(async f => {
      try {
        const rows = await listChunks(f.id, 3);
        return rows.map<RetrievedChunk>(r => ({ file_id: f.id, file_name: f.name, chunk_index: r.chunk_index, content: r.content, rank: 0.01 }));
      } catch {
        return []; // a listing failure must not lose the matches we already have
      }
    }));
    openingCandidates.push(...openings.flat());
  }

  if (!lexical.length && !dense.length && !openingCandidates.length) return { chunks: [], sources: [] };

  // Stage: merge (reciprocal rank fusion of the lexical and dense lists).
  const byKey = new Map<string, RetrievedChunk>();
  for (const c of [...lexical, ...dense]) if (!byKey.has(chunkKey(c))) byKey.set(chunkKey(c), c);
  const fused = reciprocalRankFusion(
    [{ items: lexical, weight: 1 }, { items: dense, weight: 1 }],
    chunkKey,
  );
  const maxFused = Math.max(1e-12, ...fused.values());
  const merged: RetrievedChunk[] = [...fused.entries()]
    .map(([key, score]) => ({ ...(byKey.get(key) as RetrievedChunk), rank: score / maxFused }));
  merged.push(...openingCandidates);

  // Stage: rerank (blend fused rank with query-term coverage / phrase match).
  const reranked = rerankChunks(input.query, merged);

  // Rank: attached files first, then reranked score, then document order.
  const ranked = [...reranked].sort((a, b) =>
    Number(attached.has(b.file_id)) - Number(attached.has(a.file_id))
    || b.rank - a.rank
    || a.chunk_index - b.chunk_index);

  // Stage: source diversity + duplicate suppression (single-source corpora
  // are exempt — a cap only matters when there is more than one source).
  const distinctFiles = new Set(ranked.map(c => c.file_id)).size;
  const diversified = distinctFiles > 1
    ? enforceSourceDiversity(ranked, { maxPerFile: input.maxChunksPerFile ?? 3, attachedFileIds: attached })
    : ranked;
  const deduped = dedupeChunks(diversified);

  const selected = selectWithinBudget(deduped, budget, maxChunks, attached);
  // Present chunks grouped by file, in document order, so the model reads coherent excerpts.
  selected.sort((a, b) => a.file_name.localeCompare(b.file_name) || a.chunk_index - b.chunk_index);
  return { chunks: selected, sources: toSources(selected) };
}

function selectWithinBudget(ranked: RetrievedChunk[], budget: number, maxChunks: number, attached: Set<string>): RetrievedChunk[] {
  const out: RetrievedChunk[] = [];
  const perFile = new Map<string, number>();
  const fileCap = Math.floor(budget * PER_FILE_SHARE);
  let used = 0;
  const seen = new Set<string>();
  for (const c of ranked) {
    const key = `${c.file_id}:${c.chunk_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const len = c.content.length;
    if (out.length >= maxChunks) break;
    if (used + len > budget) continue;
    const fileUsed = perFile.get(c.file_id) ?? 0;
    // Attached files may use the whole budget; others share it.
    if (!attached.has(c.file_id) && fileUsed + len > fileCap) continue;
    out.push(c);
    used += len;
    perFile.set(c.file_id, fileUsed + len);
  }
  return out;
}

export function toSources(chunks: RetrievedChunk[]): KnowledgeSource[] {
  const byFile = new Map<string, KnowledgeSource>();
  for (const c of chunks) {
    const s = byFile.get(c.file_id) ?? { file_id: c.file_id, file_name: c.file_name, chunk_indexes: [] };
    if (!s.chunk_indexes.includes(c.chunk_index)) s.chunk_indexes.push(c.chunk_index);
    byFile.set(c.file_id, s);
  }
  return [...byFile.values()].map(s => ({ ...s, chunk_indexes: [...s.chunk_indexes].sort((a, b) => a - b) }));
}

/** Pick the memories that apply to this chat: global ones plus the project's. */
export function selectMemories(memories: Memory[], projectId: string | null | undefined, budget = MEMORY_CHAR_BUDGET, max = MEMORY_MAX_ITEMS): Memory[] {
  const scoped = memories.filter(m => m.project_id === null || (projectId ? m.project_id === projectId : false));
  const ordered = [...scoped].sort((a, b) =>
    // Instructions and preferences shape every answer; include them first.
    weight(b) - weight(a) || b.importance - a.importance || b.updated_at.localeCompare(a.updated_at));
  const out: Memory[] = [];
  let used = 0;
  for (const m of ordered) {
    if (out.length >= max) break;
    if (used + m.content.length > budget) continue;
    out.push(m);
    used += m.content.length;
  }
  return out;
}

function weight(m: Memory): number {
  return m.type === 'instruction' ? 3 : m.type === 'preference' ? 2 : m.project_id ? 1 : 0;
}

export interface BuildContextInput {
  project?: Project | null;
  memories: Memory[];
  knowledge: RetrievedChunk[];
}

/** Shape everything into the wire format. Returns undefined when there is nothing to send. */
export function buildChatContext({ project, memories, knowledge }: BuildContextInput): ChatContext | undefined {
  const ctx: ChatContext = {};
  if (project) ctx.project = { name: project.name, ...(project.instructions ? { instructions: project.instructions } : {}) };
  if (memories.length) ctx.memories = memories.map(m => ({ type: m.type, content: m.content }));
  if (knowledge.length) ctx.knowledge = knowledge.map(c => ({ file_id: c.file_id, file_name: c.file_name, chunk_index: c.chunk_index, content: c.content }));
  return Object.keys(ctx).length ? ctx : undefined;
}
