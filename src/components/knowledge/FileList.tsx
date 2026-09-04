import { FileText, FolderKanban, Check } from 'lucide-react';
import type { KnowledgeFile, Project } from '../../types';
import { FileStatusBadge } from './FileStatusBadge';
import { formatFileSize } from '../../lib/files';
import { cn } from '../../lib/cn';

interface Props {
  files: KnowledgeFile[];
  projects?: Project[];
  onOpen: (file: KnowledgeFile) => void;
  /** When provided, rows become selectable (used by the composer picker). */
  selectedIds?: Set<string>;
  onToggleSelect?: (file: KnowledgeFile) => void;
  showProject?: boolean;
  dense?: boolean;
  emptyMessage?: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Plain list of files; the row is a button that opens the detail dialog. */
export function FileList({ files, projects = [], onOpen, selectedIds, onToggleSelect, showProject = true, dense, emptyMessage = 'No files yet.' }: Props) {
  if (!files.length) return <p className="px-2 py-8 text-sm text-fg-subtle text-center">{emptyMessage}</p>;
  const selectable = Boolean(selectedIds && onToggleSelect);
  return (
    <ul className="divide-y divide-border" aria-label="Files">
      {files.map(f => {
        const project = showProject && f.project_id ? projects.find(p => p.id === f.project_id) : null;
        const selected = selectedIds?.has(f.id) ?? false;
        const canSelect = selectable && f.status === 'ready';
        return (
          <li key={f.id} className={cn('flex items-center gap-3', dense ? 'py-2' : 'py-2.5', selected && 'bg-accent/5')}>
            {selectable && (
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={`Select ${f.name}`}
                disabled={!canSelect}
                onClick={() => onToggleSelect?.(f)}
                className={cn(
                  'ml-1 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                  selected ? 'bg-accent border-accent text-accent-fg' : 'border-border-strong bg-surface',
                  !canSelect && 'opacity-40 cursor-not-allowed',
                )}
              >
                {selected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpen(f)}
              className="flex-1 min-w-0 flex items-center gap-3 px-1 py-0.5 rounded-lg text-left hover:bg-surface-2/70 transition-colors"
            >
              <span className="w-8 h-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-fg-muted" aria-hidden />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-fg truncate">{f.name}</span>
                <span className="flex items-center gap-2 text-[11px] text-fg-subtle">
                  <span>{formatFileSize(f.size)}</span>
                  <span aria-hidden>·</span>
                  <span>{relativeTime(f.created_at)}</span>
                  {project && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1 truncate"><FolderKanban className="w-3 h-3" aria-hidden />{project.name}</span>
                    </>
                  )}
                </span>
              </span>
              <FileStatusBadge status={f.status} className="shrink-0" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
