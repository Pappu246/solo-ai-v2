import { useEffect, useId, useState } from 'react';
import type { Memory, MemoryType, Project } from '../../types';
import { MEMORY_TYPES } from '../../types';
import { Dialog, Button } from '../ui';
import { cn } from '../../lib/cn';

export interface MemoryDraft {
  content: string;
  type: MemoryType;
  project_id: string | null;
  importance: number;
}

interface Props {
  open: boolean;
  /** Existing memory to edit, or null to create. */
  initial: Memory | null;
  defaultProjectId?: string | null;
  /** Prefill for "Remember this" from a message. */
  defaultContent?: string;
  projects: Project[];
  onSave: (draft: MemoryDraft) => Promise<void>;
  onClose: () => void;
}

const MAX = 1000;

export function MemoryEditor({ open, initial, defaultProjectId = null, defaultContent = '', projects, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<MemoryDraft>({ content: '', type: 'fact', project_id: null, importance: 3 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentId = useId();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(initial
      ? { content: initial.content, type: initial.type, project_id: initial.project_id, importance: initial.importance }
      : { content: defaultContent, type: 'fact', project_id: defaultProjectId, importance: 3 });
  }, [open, initial, defaultProjectId, defaultContent]);

  const trimmed = draft.content.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= MAX && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try { await onSave({ ...draft, content: trimmed }); }
    catch (e) { setError((e as Error).message || 'Could not save this memory.'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? 'Edit memory' : 'Add memory'}
      description="Solo will keep this in mind in future chats."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave} loading={saving}>{initial ? 'Save changes' : 'Save memory'}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div>
          <label htmlFor={contentId} className="block text-sm font-medium text-fg mb-1.5">What should Solo remember?</label>
          <textarea
            id={contentId}
            value={draft.content}
            onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            rows={4}
            autoFocus
            maxLength={MAX + 200}
            placeholder="e.g. I write in British English and prefer short answers with examples."
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong resize-y"
          />
          <div className="flex items-center justify-between mt-1 text-[11px]">
            <span className="text-fg-subtle">Avoid passwords or other sensitive details.</span>
            <span className={cn('tabular-nums', trimmed.length > MAX ? 'text-danger' : 'text-fg-subtle')}>{trimmed.length}/{MAX}</span>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-fg mb-1.5">Type</p>
          <div role="radiogroup" aria-label="Memory type" className="grid grid-cols-2 gap-1.5">
            {(Object.keys(MEMORY_TYPES) as MemoryType[]).map(t => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={draft.type === t}
                onClick={() => setDraft(d => ({ ...d, type: t }))}
                className={cn('rounded-lg border px-3 py-2 text-left transition-colors', draft.type === t ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-2')}
              >
                <span className="block text-sm font-medium text-fg">{MEMORY_TYPES[t].label}</span>
                <span className="block text-[11px] text-fg-muted mt-0.5">{MEMORY_TYPES[t].hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-fg mb-1.5">Applies to</span>
            <select
              value={draft.project_id ?? ''}
              onChange={e => setDraft(d => ({ ...d, project_id: e.target.value || null }))}
              className="w-full h-9 px-2 rounded-lg bg-surface-2 border border-border text-sm text-fg outline-none focus:border-border-strong"
            >
              <option value="">Every chat</option>
              {projects.map(p => <option key={p.id} value={p.id}>Project: {p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-fg mb-1.5">Importance · {draft.importance}/5</span>
            <input
              type="range" min={1} max={5} step={1}
              value={draft.importance}
              onChange={e => setDraft(d => ({ ...d, importance: Number(e.target.value) }))}
              aria-label="Importance"
              className="w-full h-9 accent-[rgb(var(--accent))]"
            />
          </label>
        </div>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}
