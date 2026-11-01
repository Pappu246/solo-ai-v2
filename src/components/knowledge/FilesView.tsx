import { useMemo, useState } from 'react';
import { Search, AlertCircle } from 'lucide-react';
import type { KnowledgeFile, Project, FileStatus } from '../../types';
import type { KnowledgeController } from '../../hooks/useKnowledge';
import { FileList } from './FileList';
import { UploadDropzone } from './UploadDropzone';
import { Button, Spinner, useToast } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';

interface Props {
  knowledge: KnowledgeController;
  projects: Project[];
  onOpenFile: (file: KnowledgeFile) => void;
}

type Filter = 'all' | Exclude<FileStatus, 'uploading'>;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
];

/** The user's whole file library: upload, filter, search by name, open details. */
export function FilesView({ knowledge, projects, onOpenFile }: Props) {
  const tr = useT();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return knowledge.files.filter(f =>
      (filter === 'all' || (filter === 'processing' ? f.status === 'processing' || f.status === 'uploading' : f.status === filter))
      && (!q || f.name.toLowerCase().includes(q)));
  }, [knowledge.files, query, filter]);

  const counts = useMemo(() => ({
    all: knowledge.files.length,
    ready: knowledge.files.filter(f => f.status === 'ready').length,
    processing: knowledge.files.filter(f => f.status === 'processing' || f.status === 'uploading').length,
    failed: knowledge.files.filter(f => f.status === 'failed').length,
  }), [knowledge.files]);

  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      const outcome = await knowledge.uploadFiles(files);
      const ready = outcome.files.filter(f => f.status === 'ready').length;
      const failed = outcome.files.filter(f => f.status === 'failed').length;
      if (ready) toast({ title: ready === 1 ? tr('File ready') : `${ready} ${tr('files ready')}`, tone: 'success' });
      if (failed) toast({ title: failed === 1 ? tr('A file could not be processed') : `${failed} ${tr('files could not be processed')}`, description: tr('Open the file to see why.'), tone: 'error' });
      for (const reason of outcome.rejected) toast({ title: tr('File skipped'), description: reason, tone: 'error' });
      if (outcome.cancelled.length) toast({ title: outcome.cancelled.length === 1 ? tr('Upload cancelled') : `${outcome.cancelled.length} ${tr('uploads cancelled')}`, tone: 'info' });
    } finally { setUploading(false); }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <header className="mb-5">
          <h2 className="font-display text-2xl tracking-tight text-fg">{tr('Files')}</h2>
          <p className="text-sm text-fg-muted mt-1">{tr('Upload documents once, then attach them to chats or add them to a project. Solo only reads the parts that are relevant to your question.')}</p>
        </header>

        <UploadDropzone onFiles={upload} disabled={uploading} />

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-5">
          <div role="tablist" aria-label={tr('Filter files')} className="inline-flex p-0.5 rounded-lg bg-surface-2 border border-border self-start">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-all duration-150', filter === f.id ? 'bg-accent/12 text-fg shadow-sm ring-1 ring-accent/30' : 'text-fg-muted hover:text-fg')}
              >
                {tr(f.label)}
                <span className={cn('tabular-nums', filter === f.id ? 'text-fg-subtle' : 'text-fg-subtle/80')}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <label className="relative block flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tr('Filter by name')}
              aria-label={tr('Filter files by name')}
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle outline-hidden focus:border-border-strong"
            />
          </label>
        </div>

        <div className="mt-3 rounded-xl glass border border-border px-2 shadow-sm">
          {knowledge.status === 'loading' && knowledge.files.length === 0 && (
            <div className="flex items-center justify-center py-10 text-fg-subtle"><Spinner /></div>
          )}
          {knowledge.status === 'error' && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="w-5 h-5 text-danger" aria-hidden />
              <p className="text-sm text-fg">{knowledge.error?.title ?? tr('Couldn’t load your files.')}</p>
              <p className="text-xs text-fg-muted">{knowledge.error?.message}</p>
              <Button size="sm" variant="secondary" onClick={knowledge.reload}>{tr('Retry')}</Button>
            </div>
          )}
          {knowledge.status === 'ready' && (
            <FileList
              files={visible}
              projects={projects}
              onOpen={onOpenFile}
              progress={knowledge.progress}
              onCancelUpload={knowledge.cancelUpload}
              emptyMessage={knowledge.files.length === 0 ? tr('No files yet. Upload one above to get started.') : query ? `${tr('No files match')} “${query}”.` : tr('No files in this filter.')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
