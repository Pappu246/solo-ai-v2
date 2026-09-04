import { useEffect, useId, useState } from 'react';
import type { Project } from '../../types';
import { Dialog, Button } from '../ui';
import type { ProjectInput } from '../../hooks/useProjects';

interface Props {
  open: boolean;
  /** Existing project to edit, or null to create. */
  initial: Project | null;
  onSave: (input: ProjectInput) => Promise<void>;
  onClose: () => void;
}

const LIMITS = { name: 120, description: 2000, instructions: 4000 };

export function ProjectDialog({ open, initial, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), description: useId(), instructions: useId() };

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setInstructions(initial?.instructions ?? '');
    setError(null);
  }, [open, initial]);

  const canSave = name.trim().length > 0 && name.trim().length <= LIMITS.name && description.length <= LIMITS.description && instructions.length <= LIMITS.instructions && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try { await onSave({ name: name.trim(), description: description.trim(), instructions: instructions.trim() }); }
    catch (e) { setError((e as Error).message || 'Could not save the project.'); }
    finally { setSaving(false); }
  };

  const input = 'w-full px-3 rounded-lg bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? 'Project settings' : 'New project'}
      description="Projects group chats, files and memories around one piece of work."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave} loading={saving}>{initial ? 'Save' : 'Create project'}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div>
          <label htmlFor={ids.name} className="block text-sm font-medium text-fg mb-1.5">Name</label>
          <input id={ids.name} value={name} onChange={e => setName(e.target.value)} maxLength={LIMITS.name} autoFocus placeholder="e.g. Q3 launch plan" className={`${input} h-10`} />
        </div>
        <div>
          <label htmlFor={ids.description} className="block text-sm font-medium text-fg mb-1.5">Description <span className="font-normal text-fg-subtle">(optional)</span></label>
          <input id={ids.description} value={description} onChange={e => setDescription(e.target.value)} maxLength={LIMITS.description} placeholder="What is this project about?" className={`${input} h-10`} />
        </div>
        <div>
          <label htmlFor={ids.instructions} className="block text-sm font-medium text-fg mb-1.5">Instructions for Solo <span className="font-normal text-fg-subtle">(optional)</span></label>
          <textarea
            id={ids.instructions}
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            maxLength={LIMITS.instructions}
            rows={4}
            placeholder="e.g. We’re a B2B SaaS team. Keep answers practical, prefer TypeScript examples, and flag anything that affects pricing."
            className={`${input} py-2 resize-y`}
          />
          <p className="text-[11px] text-fg-subtle mt-1">Sent with every chat in this project. {instructions.length}/{LIMITS.instructions}</p>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}
