import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { KnowledgeFile, Project } from '../../types';
import { Dialog, Button } from '../ui';
import { FileList } from './FileList';

interface Props {
  open: boolean;
  files: KnowledgeFile[];
  projects: Project[];
  alreadySelected: string[];
  onConfirm: (files: KnowledgeFile[]) => void;
  onClose: () => void;
}

/** Pick previously uploaded files to attach to the current message. */
export function FilePickerDialog({ open, files, projects, alreadySelected, onConfirm, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(alreadySelected));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter(f => f.status !== 'uploading' && (!q || f.name.toLowerCase().includes(q)));
  }, [files, query]);

  const toggle = (f: KnowledgeFile) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
    return next;
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Attach from your files"
      description="Only files marked Ready can be used in a chat."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={selected.size === 0} onClick={() => onConfirm(files.filter(f => selected.has(f.id)))}>
            Attach {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </>
      }
    >
      <label className="relative block mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by name"
          aria-label="Filter files by name"
          autoFocus
          className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-border-strong"
        />
      </label>
      <div className="rounded-xl border border-border px-1 max-h-[50vh] overflow-y-auto">
        <FileList
          files={visible}
          projects={projects}
          onOpen={f => { if (f.status === 'ready') toggle(f); }}
          selectedIds={selected}
          onToggleSelect={toggle}
          dense
          emptyMessage={files.length ? `No files match “${query}”.` : 'You haven’t uploaded any files yet. Use the paperclip to upload one.'}
        />
      </div>
    </Dialog>
  );
}
