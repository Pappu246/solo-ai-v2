/**
 * Global search client. All ranking and permission filtering happens in the
 * `search_all` Postgres function (RLS-enforced); this module only shapes the
 * request and groups the response for the UI.
 */
import { supabase } from '../supabase';
import { AppError } from '../errors';
import type { SearchKind, SearchResult } from '../../types';

export const SEARCH_KINDS: SearchKind[] = ['conversation', 'message', 'project', 'file', 'memory'];
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_PAGE_SIZE = 10;

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  conversation: 'Chats',
  message: 'Messages',
  project: 'Projects',
  file: 'Files',
  memory: 'Memories',
};

export interface SearchPage {
  results: SearchResult[];
  /** True when another page of the same kind is likely available. */
  hasMore: boolean;
}

export async function searchAll(query: string, opts: { kinds?: SearchKind[]; limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<SearchPage> {
  const q = query.trim();
  const limit = opts.limit ?? 30;
  if (q.length < SEARCH_MIN_CHARS) return { results: [], hasMore: false };
  let request = supabase.rpc('search_all', { p_query: q, p_kinds: opts.kinds ?? null, p_limit: limit, p_offset: opts.offset ?? 0 });
  if (opts.signal) request = request.abortSignal(opts.signal);
  const { data, error } = await request;
  if (error) throw new AppError('Search failed', undefined, `${error.code ? `[${error.code}] ` : ''}${error.message}`);
  const results = ((data ?? []) as SearchResult[]).map(r => ({ ...r, rank: Number(r.rank ?? 0) }));
  return { results, hasMore: results.length >= limit };
}

export type GroupedResults = Partial<Record<SearchKind, SearchResult[]>>;

export function groupResults(results: SearchResult[]): GroupedResults {
  const grouped: GroupedResults = {};
  for (const r of results) (grouped[r.kind] ||= []).push(r);
  return grouped;
}

/**
 * Split a snippet on the ⟦ ⟧ markers emitted by `ts_headline` so the UI can
 * highlight matches without ever rendering HTML from the database.
 */
export function splitHighlights(snippet: string | null | undefined): Array<{ text: string; hit: boolean }> {
  if (!snippet) return [];
  const parts: Array<{ text: string; hit: boolean }> = [];
  const re = /⟦([^⟧]*)⟧/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet))) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), hit: false });
    parts.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}
