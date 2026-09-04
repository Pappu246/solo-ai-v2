import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquare, MessagesSquare, FolderKanban, FileText, Brain, CornerDownLeft } from 'lucide-react';
import type { SearchKind, SearchResult } from '../../types';
import { useSearch } from '../../hooks/useSearch';
import { SEARCH_KINDS, SEARCH_KIND_LABELS, SEARCH_MIN_CHARS, splitHighlights } from '../../lib/knowledge/search';
import { Dialog, Kbd, Spinner, Button } from '../ui';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenResult: (result: SearchResult) => void;
}

const ICONS: Record<SearchKind, typeof MessageSquare> = {
  conversation: MessageSquare,
  message: MessagesSquare,
  project: FolderKanban,
  file: FileText,
  memory: Brain,
};

/**
 * ⌘K palette searching chats, messages, projects, files and memories.
 * Results are grouped by kind, keyboard navigable, and each group can load more.
 */
export function SearchPalette({ open, onClose, onOpenResult }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const search = useSearch(query, open);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setQuery(''); setActive(0); } }, [open]);
  useEffect(() => { setActive(0); }, [search.flat.length, query]);

  // Stable ordered list for keyboard navigation (matches visual order).
  const ordered = useMemo(() => SEARCH_KINDS.flatMap(k => search.groups[k] ?? []), [search.groups]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (r: SearchResult) => { onOpenResult(r); onClose(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(ordered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && ordered[active]) { e.preventDefault(); choose(ordered[active]); }
  };

  const tooShort = query.trim().length < SEARCH_MIN_CHARS;

  return (
    <Dialog open={open} onClose={onClose} title="Search" hideHeader size="lg" className="sm:mt-[-10vh]">
      <div className="-mx-5 -mt-0 flex flex-col max-h-[70vh]" onKeyDown={onKeyDown}>
        <label className="relative flex items-center border-b border-border px-4">
          <Search className="w-4 h-4 text-fg-subtle shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats, messages, projects, files and memories"
            aria-label="Search everything"
            role="combobox"
            aria-expanded={ordered.length > 0}
            aria-controls="search-results"
            aria-activedescendant={ordered[active] ? `search-result-${ordered[active].kind}-${ordered[active].id}` : undefined}
            autoFocus
            className="flex-1 h-12 px-3 bg-transparent text-[0.95rem] text-fg placeholder:text-fg-subtle outline-none"
          />
          {search.status === 'searching' ? <Spinner className="w-4 h-4 text-fg-subtle" /> : <Kbd>Esc</Kbd>}
        </label>

        <div ref={listRef} id="search-results" role="listbox" aria-label="Search results" className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {tooShort && (
            <p className="px-3 py-8 text-sm text-fg-subtle text-center">Type at least {SEARCH_MIN_CHARS} characters to search.</p>
          )}
          {!tooShort && search.status === 'error' && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-fg">{search.error?.title}</p>
              <p className="text-xs text-fg-muted mt-0.5">{search.error?.message}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={search.retry}>Try again</Button>
            </div>
          )}
          {!tooShort && search.status === 'ready' && ordered.length === 0 && (
            <p className="px-3 py-8 text-sm text-fg-subtle text-center">No results for “{query.trim()}”.</p>
          )}
          {!tooShort && ordered.length > 0 && SEARCH_KINDS.map(kind => {
            const items = search.groups[kind];
            if (!items?.length) return null;
            const Icon = ICONS[kind];
            const offset = ordered.indexOf(items[0]);
            return (
              <section key={kind} aria-label={SEARCH_KIND_LABELS[kind]} className="mb-2">
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{SEARCH_KIND_LABELS[kind]}</p>
                {items.map((r, i) => {
                  const index = offset + i;
                  const selected = index === active;
                  return (
                    <button
                      key={`${r.kind}-${r.id}`}
                      type="button"
                      id={`search-result-${r.kind}-${r.id}`}
                      role="option"
                      aria-selected={selected}
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(r)}
                      className={cn('w-full flex items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors', selected ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
                    >
                      <Icon className="w-4 h-4 text-fg-muted mt-0.5 shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-fg truncate">{r.title}</span>
                        {r.snippet && (
                          <span className="block text-xs text-fg-muted mt-0.5 line-clamp-2">
                            {splitHighlights(r.snippet).map((p, j) => p.hit ? <mark key={j} className="bg-accent/20 text-fg rounded-sm px-px">{p.text}</mark> : <span key={j}>{p.text}</span>)}
                          </span>
                        )}
                      </span>
                      {selected && <CornerDownLeft className="w-3.5 h-3.5 text-fg-subtle mt-1 shrink-0" aria-hidden />}
                    </button>
                  );
                })}
                {!search.exhausted[kind] && items.length >= 5 && (
                  <button
                    type="button"
                    onClick={() => search.loadMore(kind)}
                    disabled={search.loadingMore !== null}
                    className="ml-2.5 mt-0.5 text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    {search.loadingMore === kind ? 'Loading…' : `More ${SEARCH_KIND_LABELS[kind].toLowerCase()}`}
                  </button>
                )}
              </section>
            );
          })}
        </div>

        <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="ml-auto">Only your own data is searched.</span>
        </div>
      </div>
    </Dialog>
  );
}
