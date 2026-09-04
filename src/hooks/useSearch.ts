import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchKind, SearchResult } from '../types';
import { searchAll, groupResults, SEARCH_MIN_CHARS, SEARCH_PAGE_SIZE, type GroupedResults } from '../lib/knowledge/search';
import { toFriendlyError, type FriendlyError } from '../lib/errors';

export type SearchStatus = 'idle' | 'searching' | 'ready' | 'error';

const DEBOUNCE_MS = 220;

/**
 * Debounced global search with per-group "show more" pagination.
 * Stale responses are discarded so fast typing never shows old results.
 */
export function useSearch(query: string, enabled: boolean) {
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [groups, setGroups] = useState<GroupedResults>({});
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loadingMore, setLoadingMore] = useState<SearchKind | null>(null);
  const [exhausted, setExhausted] = useState<Partial<Record<SearchKind, boolean>>>({});
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (!enabled) return;
    abortRef.current?.abort();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setStatus('idle'); setGroups({}); setError(null); setExhausted({});
      return;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('searching');
    const timer = window.setTimeout(async () => {
      try {
        const page = await searchAll(trimmed, { limit: 30, signal: controller.signal });
        if (id !== requestId.current) return;
        setGroups(groupResults(page.results));
        setExhausted({});
        setError(null);
        setStatus('ready');
      } catch (e) {
        if (id !== requestId.current || controller.signal.aborted) return;
        setError(toFriendlyError(e));
        setStatus('error');
      }
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [trimmed, enabled]);

  const loadMore = useCallback(async (kind: SearchKind) => {
    if (loadingMore || trimmed.length < SEARCH_MIN_CHARS) return;
    const current = groups[kind] ?? [];
    setLoadingMore(kind);
    try {
      const page = await searchAll(trimmed, { kinds: [kind], limit: SEARCH_PAGE_SIZE, offset: current.length });
      const seen = new Set(current.map(r => r.id));
      const fresh = page.results.filter(r => !seen.has(r.id));
      setGroups(prev => ({ ...prev, [kind]: [...(prev[kind] ?? []), ...fresh] }));
      if (!page.hasMore || !fresh.length) setExhausted(prev => ({ ...prev, [kind]: true }));
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      setLoadingMore(null);
    }
  }, [groups, loadingMore, trimmed]);

  const retry = useCallback(() => {
    // Re-run the effect by bumping the request id and forcing a status change.
    requestId.current++;
    setStatus('idle');
    setError(null);
    // The effect keys off `trimmed`; a no-op setState won't retrigger it, so
    // call the search directly.
    if (trimmed.length >= SEARCH_MIN_CHARS) {
      const id = ++requestId.current;
      setStatus('searching');
      searchAll(trimmed, { limit: 30 })
        .then(page => { if (id === requestId.current) { setGroups(groupResults(page.results)); setStatus('ready'); } })
        .catch(e => { if (id === requestId.current) { setError(toFriendlyError(e)); setStatus('error'); } });
    }
  }, [trimmed]);

  const total = Object.values(groups).reduce((n, list) => n + (list?.length ?? 0), 0);
  const flat: SearchResult[] = Object.values(groups).flatMap(list => list ?? []);

  return { status, groups, flat, total, error, loadMore, loadingMore, exhausted, retry };
}
