import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { KNOWLEDGE_ACCEPT, KNOWLEDGE_MAX_FILES_PER_UPLOAD } from '../../lib/knowledge/fileTypes';
import { cn } from '../../lib/cn';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Extra copy under the title, e.g. which project files will be added to. */
  hint?: string;
}

/** Click-or-drop upload target. Accessible: it is a real button, not a div with handlers. */
export function UploadDropzone({ onFiles, disabled, compact, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = (list: FileList | null) => {
    if (!list?.length) return;
    onFiles(Array.from(list).slice(0, KNOWLEDGE_MAX_FILES_PER_UPLOAD));
  };

  return (
    <div
      onDragOver={e => { if (disabled) return; e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files); }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'w-full rounded-xl border border-dashed transition-colors text-left',
          compact ? 'px-3 py-2.5 flex items-center gap-3' : 'px-4 py-6 flex flex-col items-center text-center gap-1.5',
          dragging ? 'border-accent bg-accent/5' : 'border-border-strong hover:border-fg-subtle hover:bg-surface-2/60',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <UploadCloud className={cn('text-fg-muted shrink-0', compact ? 'w-4 h-4' : 'w-6 h-6')} aria-hidden />
        <span className="min-w-0">
          <span className={cn('block font-medium text-fg', compact ? 'text-sm' : 'text-sm')}>
            {dragging ? 'Drop to upload' : compact ? 'Upload files' : 'Click to upload or drop files here'}
          </span>
          <span className="block text-[11px] text-fg-subtle mt-0.5">
            {hint ?? 'PDF, text, Markdown, CSV, JSON or code · up to 20 MB each'}
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={KNOWLEDGE_ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={e => { handle(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
