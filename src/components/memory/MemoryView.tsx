import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Brain, AlertCircle, FolderKanban, MessageSquare, Globe } from 'lucide-react';
import type { Memory, MemoryType, Project } from '../../types';
import { MEMORY_TYPES } from '../../types';
import type { MemoriesController } from '../../hooks/useMemories';
import { Button, ConfirmDialog, IconButton, Spinner, useToast } from '../ui';
import { MemoryEditor, type MemoryDraft } from './MemoryEditor';
import { toFriendlyError } from '../../lib/errors';
import { cn } from '../../lib/cn';

interface Props {
  memories: MemoriesController;
  projects: Project[];
  /** Pre-select this project's scope when the view is opened from a project. */
  projectId?: string | null;
  onOpenConversation?: (conversationId: string) => void;
}

type Scope = 'all' | 'global' | string; // string = project id

/**
 * Memory is explicit and inspectable: everything Solo remembers is listed
 * here, can be edited, and can be deleted. Nothing is saved without the user
 * asking for it (Memory view, or "Remember this" on a message).
 */
export function MemoryView({ memories, projects, projectId, onOpenConversation }: Props) {
  const [scope, setScope] = useState<Scope>(projectId ?? 'all');
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all');
  const [editing, setEditing] = useState<Memory | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const { toast } = useToast();

  const visible = useMemo(() => memories.memories.filter(m =>
    (scope === 'all' || (scope === 'global' ? m.project_id === null : m.project_id === scope))
    && (typeFilter === 'all' || m.type === typeFilter)), [memories.memories, scope, typeFilter]);

  const activeProjects = projects.filter(p => !p.archived);

  const save = async (draft: MemoryDraft) => {
    try {
      if (editing === 'new') {
        await memories.addMemory({ content: draft.content, type: draft.type, project_id: draft.project_id, importance: draft.importance, source: 'user' });
        toast({ title: 'Memory saved', tone: 'success' });
      } else if (editing) {
        await memories.updateMemory(editing.id, { content: draft.content, type: draft.type, project_id: draft.project_id, importance: draft.importance });
        toast({ title: 'Memory updated', tone: 'success' });
      }
      setEditing(null);
    } catch (e) {
      const err = toFriendlyError(e);
      toast({ title: err.title, description: err.message, tone: 'error' });
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try { await memories.deleteMemory(target.id); toast({ title: 'Memory deleted', tone: 'success' }); }
    catch (e) { const err = toFriendlyError(e); toast({ title: err.title, description: err.message, tone: 'error' }); }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <header className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-fg">Memory</h2>
            <p className="text-sm text-fg-muted mt-1">
              Things you’ve asked Solo to keep in mind. Memories are only saved when you add them, and you can edit or delete any of them at any time.
            </p>
          </div>
          <Button variant="primary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing('new')} className="shrink-0">
            Add memory
          </Button>
        </header>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-xs text-fg-muted flex items-center gap-2">
            <span className="sr-only sm:not-sr-only">Scope</span>
            <select value={scope} onChange={e => setScope(e.target.value)} aria-label="Scope" className="h-8 px-2 rounded-lg bg-surface-2 border border-border text-sm text-fg outline-none focus:border-border-strong">
              <option value="all">All memories</option>
              <option value="global">Every chat</option>
              {activeProjects.map(p => <option key={p.id} value={p.id}>Project: {p.name}</option>)}
            </select>
          </label>
          <div role="tablist" aria-label="Filter by type" className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border self-start overflow-x-auto max-w-full">
            {(['all', ...Object.keys(MEMORY_TYPES)] as Array<MemoryType | 'all'>).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                className={cn('h-7 px-2.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors', typeFilter === t ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg')}
              >
                {t === 'all' ? 'All types' : MEMORY_TYPES[t].label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="mt-3 rounded-xl border border-border bg-surface">
          {memories.status === 'loading' && memories.memories.length === 0 && (
            <div className="flex items-center justify-center py-10 text-fg-subtle"><Spinner /></div>
          )}
          {memories.status === 'error' && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="w-5 h-5 text-danger" aria-hidden />
              <p className="text-sm text-fg">{memories.error?.title ?? 'Couldn’t load memories.'}</p>
              <p className="text-xs text-fg-muted">{memories.error?.message}</p>
              <Button size="sm" variant="secondary" onClick={memories.reload}>Retry</Button>
            </div>
          )}
          {memories.status === 'ready' && visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center px-6">
              <Brain className="w-6 h-6 text-fg-subtle" aria-hidden />
              <p className="text-sm text-fg">{memories.memories.length === 0 ? 'Solo doesn’t remember anything yet.' : 'No memories match these filters.'}</p>
              {memories.memories.length === 0 && (
                <p className="text-xs text-fg-muted max-w-sm">Add a preference like “Answer in British English”, a fact about your work, or a standing instruction. Memories are included in future chats.</p>
              )}
            </div>
          )}
          {memories.status === 'ready' && visible.length > 0 && (
            <ul className="divide-y divide-border" aria-label="Memories">
              {visible.map(m => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  project={m.project_id ? projects.find(p => p.id === m.project_id) ?? null : null}
                  onEdit={() => setEditing(m)}
                  onDelete={() => setPendingDelete(m)}
                  onOpenConversation={onOpenConversation}
                />
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-fg-subtle mt-3 leading-relaxed">
          Keep memories short and general. Avoid passwords, payment details, or other sensitive information — Solo never needs them.
        </p>
      </div>

      <MemoryEditor
        open={editing !== null}
        initial={editing && editing !== 'new' ? editing : null}
        defaultProjectId={scope !== 'all' && scope !== 'global' ? scope : null}
        projects={activeProjects}
        onSave={save}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this memory?"
        description={pendingDelete ? `“${pendingDelete.content.slice(0, 120)}${pendingDelete.content.length > 120 ? '…' : ''}” will no longer be used in chats.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function MemoryRow({ memory: m, project, onEdit, onDelete, onOpenConversation }: {
  memory: Memory; project: Project | null; onEdit: () => void; onDelete: () => void; onOpenConversation?: (id: string) => void;
}) {
  return (
    <li className="group flex items-start gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fg whitespace-pre-wrap break-words">{m.content}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-medium text-fg-muted">{MEMORY_TYPES[m.type].label}</span>
          <span className="inline-flex items-center gap-1">
            {project ? <><FolderKanban className="w-3 h-3" aria-hidden />{project.name}</> : <><Globe className="w-3 h-3" aria-hidden />Every chat</>}
          </span>
          <span aria-hidden>·</span>
          <span title="Importance">{'●'.repeat(m.importance)}{'○'.repeat(5 - m.importance)}</span>
          <span aria-hidden>·</span>
          <span>{m.source === 'chat' ? 'Saved from a chat' : 'Added by you'}</span>
          {m.source_conversation_id && onOpenConversation && (
            <button type="button" onClick={() => onOpenConversation(m.source_conversation_id!)} className="inline-flex items-center gap-1 text-accent hover:underline">
              <MessageSquare className="w-3 h-3" aria-hidden /> Open chat
            </button>
          )}
          <span aria-hidden>·</span>
          <time dateTime={m.updated_at}>{new Date(m.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <IconButton label={`Edit memory: ${m.content.slice(0, 40)}`} size="sm" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></IconButton>
        <IconButton label={`Delete memory: ${m.content.slice(0, 40)}`} size="sm" tone="danger" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></IconButton>
      </div>
    </li>
  );
}
