import { useEffect, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Trash2, FolderKanban, MessageSquare, FileText } from 'lucide-react';
import type { KnowledgeFile, Project, FileChunk } from '../../types';
import { Dialog, Button, ConfirmDialog, Spinner } from '../ui';
import { FileStatusBadge } from './FileStatusBadge';
import { formatFileSize } from '../../lib/files';
import { chunksApi, filesApi } from '../../lib/knowledge/api';
import { detectFileType } from '../../lib/knowledge/fileTypes';
import { toFriendlyError } from '../../lib/errors';
import { cn } from '../../lib/cn';

interface Props {
  file: KnowledgeFile | null;
  projects: Project[];
  onClose: () => void;
  onDelete: (file: KnowledgeFile) => Promise<void>;
  onRetry: (file: KnowledgeFile) => Promise<unknown>;
  onAssignProject: (file: KnowledgeFile, projectId: string | null) => Promise<void>;
  /** Navigate to the chat this file is attached to, if any. */
  onOpenConversation?: (conversationId: string) => void;
  onOpenProject?: (projectId: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Everything about one file: metadata, processing state, project link,
 * a peek at the extracted text, and the actions that make sense for its state.
 */
export function FileDetailDialog({ file, projects, onClose, onDelete, onRetry, onAssignProject, onOpenConversation, onOpenProject }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<'retry' | 'download' | 'project' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<FileChunk[] | null>(null);
  const [chunksError, setChunksError] = useState<string | null>(null);

  const open = file !== null;
  const fileId = file?.id;
  const status = file?.status;

  // Load a short excerpt of the indexed text once the file is ready.
  useEffect(() => {
    setChunks(null); setChunksError(null); setActionError(null);
    if (!fileId || status !== 'ready') return;
    let cancelled = false;
    chunksApi.listForFile(fileId, 2)
      .then(rows => { if (!cancelled) setChunks(rows); })
      .catch(e => { if (!cancelled) setChunksError(toFriendlyError(e).message); });
    return () => { cancelled = true; };
  }, [fileId, status]);

  if (!file) return null;

  const type = detectFileType({ name: file.name, type: file.mime_type });
  const project = file.project_id ? projects.find(p => p.id === file.project_id) ?? null : null;
  const meta = file.metadata;
  const busyState = file.status === 'uploading' || file.status === 'processing';

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(kind); setActionError(null);
    try { await fn(); }
    catch (e) { setActionError(toFriendlyError(e).message); }
    finally { setBusy(null); }
  };

  const download = () => run('download', async () => {
    const url = await filesApi.signedUrl(file.storage_path, 60);
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.rel = 'noopener'; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
  });

  return (
    <>
      <Dialog open={open} onClose={onClose} title={file.name} description={type ? `${type.label} · ${formatFileSize(file.size)}` : formatFileSize(file.size)} size="md">
        <div className="space-y-5">
          {/* Status */}
          <section aria-label="Status" className={cn('rounded-xl border p-3.5', file.status === 'failed' ? 'border-danger/25 bg-danger/5' : 'border-border bg-surface-2/50')}>
            <div className="flex items-center justify-between gap-3">
              <FileStatusBadge status={file.status} className="text-xs" />
              {busyState && <Spinner className="w-3.5 h-3.5 text-fg-subtle" />}
            </div>
            <p className="text-sm text-fg-muted mt-1.5">
              {file.status === 'uploading' && 'Sending the file to secure storage…'}
              {file.status === 'processing' && 'Reading the file and preparing it for search. This usually takes a few seconds.'}
              {file.status === 'ready' && `Indexed ${file.chunk_count} ${file.chunk_count === 1 ? 'passage' : 'passages'} (${file.char_count.toLocaleString()} characters). Solo can now use this file in chats where it’s attached or in its project.`}
              {file.status === 'failed' && (file.error || 'Something went wrong while processing this file.')}
            </p>
            {meta.truncated && file.status === 'ready' && (
              <p className="text-xs text-warning mt-1.5">This file is large; only the first part was indexed.</p>
            )}
          </section>

          {/* Details */}
          <section aria-label="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="Type">{type?.label ?? 'Unknown'} <span className="text-fg-subtle">· {file.mime_type}</span></Row>
              <Row label="Size">{formatFileSize(file.size)}</Row>
              {typeof meta.pages === 'number' && <Row label="Pages">{meta.pages.toLocaleString()}</Row>}
              {typeof meta.rows === 'number' && <Row label="Rows">{meta.rows.toLocaleString()}</Row>}
              {typeof meta.lines === 'number' && typeof meta.rows !== 'number' && <Row label="Lines">{meta.lines.toLocaleString()}</Row>}
              <Row label="Uploaded">{formatDate(file.created_at)}</Row>
              {meta.processed_at && <Row label="Processed">{formatDate(meta.processed_at)}{typeof meta.processing_ms === 'number' && <span className="text-fg-subtle"> · {(meta.processing_ms / 1000).toFixed(1)}s</span>}</Row>}
              <Row label="Project">
                <div className="flex items-center gap-2">
                  <select
                    value={file.project_id ?? ''}
                    disabled={busy === 'project'}
                    onChange={e => run('project', () => onAssignProject(file, e.target.value || null))}
                    aria-label="Project"
                    className="h-8 max-w-full px-2 rounded-lg bg-surface-2 border border-border text-sm text-fg outline-none focus:border-border-strong disabled:opacity-50"
                  >
                    <option value="">No project</option>
                    {projects.filter(p => !p.archived || p.id === file.project_id).map(p => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}
                  </select>
                  {project && onOpenProject && (
                    <button type="button" onClick={() => { onClose(); onOpenProject(project.id); }} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      <FolderKanban className="w-3 h-3" /> Open
                    </button>
                  )}
                </div>
              </Row>
              {file.conversation_id && onOpenConversation && (
                <Row label="Chat">
                  <button type="button" onClick={() => { onClose(); onOpenConversation(file.conversation_id!); }} className="inline-flex items-center gap-1 text-accent hover:underline">
                    <MessageSquare className="w-3.5 h-3.5" /> Open the chat this file was added to
                  </button>
                </Row>
              )}
            </dl>
          </section>

          {/* Excerpt */}
          {file.status === 'ready' && (
            <section aria-label="Excerpt">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle mb-2">Indexed text</p>
              {chunks === null && !chunksError && <div className="flex items-center gap-2 text-xs text-fg-subtle"><Spinner className="w-3 h-3" /> Loading excerpt…</div>}
              {chunksError && <p className="text-xs text-danger">{chunksError}</p>}
              {chunks && chunks.length === 0 && <p className="text-xs text-fg-subtle">No text to show.</p>}
              {chunks && chunks.length > 0 && (
                <div className="space-y-2">
                  {chunks.map(c => (
                    <pre key={c.id} className="text-[12px] leading-relaxed text-fg-muted whitespace-pre-wrap break-words font-sans bg-surface-2/60 border border-border rounded-lg p-3 max-h-40 overflow-auto">
                      {c.content.length > 900 ? `${c.content.slice(0, 900)}…` : c.content}
                    </pre>
                  ))}
                  {file.chunk_count > chunks.length && <p className="text-[11px] text-fg-subtle">Showing {chunks.length} of {file.chunk_count} passages.</p>}
                </div>
              )}
            </section>
          )}

          {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}

          {/* Actions */}
          <section aria-label="Actions" className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
            <div className="flex flex-wrap items-center gap-2 pt-3 flex-1">
              {file.status === 'failed' && meta.uploaded && (
                <Button size="sm" variant="secondary" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} loading={busy === 'retry'} disabled={busy !== null} onClick={() => run('retry', () => onRetry(file))}>
                  Retry processing
                </Button>
              )}
              {meta.uploaded && (
                <Button size="sm" variant="ghost" leftIcon={<Download className="w-3.5 h-3.5" />} loading={busy === 'download'} disabled={busy !== null} onClick={download}>
                  Download
                </Button>
              )}
            </div>
            <div className="pt-3">
              <Button size="sm" variant="danger" leftIcon={<Trash2 className="w-3.5 h-3.5" />} disabled={busy !== null || file.status === 'uploading'} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </div>
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this file?"
        description={`“${file.name}” will be removed from storage and from every chat and project it was used in. This can’t be undone.`}
        confirmLabel="Delete file"
        destructive
        onConfirm={async () => {
          try { await onDelete(file); setConfirmDelete(false); onClose(); }
          catch (e) { setConfirmDelete(false); setActionError(toFriendlyError(e).message); }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-subtle whitespace-nowrap pt-0.5">{label}</dt>
      <dd className="text-fg min-w-0 break-words">{children}</dd>
    </>
  );
}

export function FileIcon({ className }: { className?: string }) {
  return <FileText className={className} aria-hidden />;
}
