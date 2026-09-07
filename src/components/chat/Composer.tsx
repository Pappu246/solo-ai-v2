import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { ArrowUp, Square, Paperclip, X, FileText, Image as ImageIcon, Mic, MicOff, Library, AlertCircle, Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import type { Attachment, KnowledgeFile } from '../../types';
import { processFile, formatFileSize, ACCEPTED_TYPES, MAX_FILE_SIZE } from '../../lib/files';
import { detectFileType, KNOWLEDGE_ACCEPT } from '../../lib/knowledge/fileTypes';
import { attachmentFromFile } from '../../lib/knowledge/attachments';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { IconButton } from '../ui';
import { cn } from '../../lib/cn';

export interface ComposerHandle { focus: () => void }

/** Phase 2: the composer can hand document files to the knowledge pipeline. */
export interface KnowledgeUploader {
  /** Upload + index files; resolves once every file is ready or failed. `onChange` streams state. */
  upload: (files: File[], onChange: (file: KnowledgeFile) => void) => Promise<KnowledgeFile[]>;
  /** Open the "attach from library" picker; resolves with the chosen files (or []). */
  pickFromLibrary?: () => Promise<KnowledgeFile[]>;
  /** Cancel an upload that is still sending bytes. Returns false when it can no longer be cancelled. */
  cancelUpload?: (fileId: string) => boolean;
  /** Byte-level progress per file id for uploads in flight. */
  progress?: Record<string, { sent: number; total: number }>;
  /** Live library rows, so chips can follow state changes made elsewhere. */
  files?: KnowledgeFile[];
  /** Re-run indexing for a file whose upload completed but processing failed. */
  retryProcessing?: (fileId: string) => Promise<void>;
}

interface Props {
  onSend: (message: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  isGenerating: boolean;
  sendOnEnter: boolean;
  disabled?: boolean;
  /** Short helper text under the box (e.g. active model). */
  hint?: string;
  autoFocus?: boolean;
  knowledge?: KnowledgeUploader;
}

const MAX_ATTACHMENTS = 6;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, onStop, isGenerating, sendOnEnter, disabled, hint, autoFocus, knowledge }, ref,
) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Original File objects for uploads this composer started, so failures can be retried. */
  const fileRefs = useRef(new Map<string, File>());
  /** Not yet linked to a row id (rows are registered by the pipeline): keyed by name|size. */
  const pendingFiles = useRef(new Map<string, File>());
  /** Per-chip retry action, chosen when the file fails (re-upload vs re-process). */
  const retryPlans = useRef(new Map<string, () => Promise<unknown>>());

  const speech = useSpeechInput(transcript => setValue(v => (v ? `${v} ${transcript}` : transcript)));

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  useEffect(() => { if (autoFocus) textareaRef.current?.focus(); }, [autoFocus]);

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const pendingKnowledge = attachments.some(a => a.file_id && (a.status === 'uploading' || a.status === 'processing'));
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isGenerating && !disabled && !processing && !pendingKnowledge;

  const submit = useCallback(() => {
    if (!canSend) return;
    // Failed knowledge files are dropped rather than sent as empty context.
    const usable = attachments.filter(a => !a.file_id || a.status === 'ready');
    onSend(value.trim(), usable.length ? usable : undefined);
    setValue('');
    setAttachments([]);
    fileRefs.current.clear();
    pendingFiles.current.clear();
    retryPlans.current.clear();
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [canSend, onSend, value, attachments]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const wantsSend = sendOnEnter ? !e.shiftKey : (e.metaKey || e.ctrlKey);
    if (wantsSend) { e.preventDefault(); submit(); }
  };

  const upsertAttachment = useCallback((f: KnowledgeFile) => {
    // Link the original File to the row once the pipeline registers it, so a
    // failed upload can be retried with the same bytes.
    if (f.status === 'uploading' && !fileRefs.current.has(f.id)) {
      const key = `${f.name}|${f.size}`;
      const file = pendingFiles.current.get(key);
      if (file) { fileRefs.current.set(f.id, file); pendingFiles.current.delete(key); }
    }
    // Remember how to bring a failed chip back to life.
    if (f.status === 'failed') {
      if (f.metadata.uploaded && knowledge?.retryProcessing) {
        retryPlans.current.set(f.id, () => knowledge.retryProcessing!(f.id));
      } else {
        const file = fileRefs.current.get(f.id);
        if (file && knowledge) {
          retryPlans.current.set(f.id, async () => {
            setAttachments(prev => prev.filter(a => a.id !== f.id)); // stale row; a fresh one follows
            return knowledge.upload([file], upsertAttachment);
          });
        }
      }
    }
    setAttachments(prev => {
      const next = attachmentFromFile(f);
      return prev.some(a => a.id === next.id) ? prev.map(a => (a.id === next.id ? next : a)) : [...prev, next];
    });
  }, [knowledge]);

  // Keep chips in sync with the live rows (covers re-processing retries, which
  // update the knowledge store without going through the composer's callback).
  const knowledgeFiles = knowledge?.files;
  useEffect(() => {
    if (!knowledgeFiles) return;
    const rows = new Map(knowledgeFiles.map(f => [f.id, f]));
    setAttachments(prev => {
      let changed = false;
      const next = prev.map(a => {
        if (!a.file_id) return a;
        const row = rows.get(a.file_id);
        if (row && (row.status !== a.status || (row.error ?? undefined) !== a.error)) {
          changed = true;
          return attachmentFromFile(row);
        }
        return a;
      });
      return changed ? next : prev;
    });
  }, [knowledgeFiles]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setFileError(null);
    const list = Array.from(files);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setFileError(`You can attach up to ${MAX_ATTACHMENTS} files.`); return; }
    const errors: string[] = [];
    const images: File[] = [];
    const documents: File[] = [];
    for (const f of list) {
      if (ACCEPTED_TYPES[f.type] === 'image') {
        // Images travel inline (base64) with the request, so they keep a hard cap.
        if (f.size > MAX_FILE_SIZE) { errors.push(`${f.name}: images must be under ${formatFileSize(MAX_FILE_SIZE)}`); continue; }
        images.push(f); continue;
      }
      // Documents go through the resumable knowledge pipeline: no client cap here.
      if (knowledge && detectFileType(f)) { documents.push(f); continue; }
      if (!knowledge && ACCEPTED_TYPES[f.type]) {
        if (f.size > MAX_FILE_SIZE) { errors.push(`${f.name}: larger than ${formatFileSize(MAX_FILE_SIZE)}`); continue; }
        documents.push(f); continue;
      }
      errors.push(`${f.name}: unsupported type`);
    }
    const accepted = [...images, ...documents].slice(0, room);
    if (errors.length) setFileError(errors.join(' · '));
    if (!accepted.length) return;
    setProcessing(true);
    try {
      const inlineFiles = accepted.filter(f => images.includes(f) || !knowledge);
      const knowledgeFiles = knowledge ? accepted.filter(f => documents.includes(f)) : [];
      if (inlineFiles.length) {
        const processed = await Promise.all(inlineFiles.map(processFile));
        setAttachments(prev => [...prev, ...processed]);
      }
      if (knowledgeFiles.length && knowledge) {
        setProcessing(false);
        knowledgeFiles.forEach(f => { pendingFiles.current.set(`${f.name}|${f.size}`, f); });
        // Runs in the background; chips update as each file moves through its lifecycle.
        knowledge.upload(knowledgeFiles, upsertAttachment)
          .then(done => {
            // Anything that never came back "ready" or "failed" was cancelled: drop its chip.
            const finished = new Set(done.map(f => f.id));
            setAttachments(prev => prev.filter(a => !a.file_id || finished.has(a.file_id) || a.status === 'ready' || a.status === 'failed'));
          })
          .catch(() => setFileError('Could not upload one of the files.'));
      }
    } catch {
      setFileError('Could not read one of the files.');
    } finally { setProcessing(false); }
  }, [attachments.length, knowledge, upsertAttachment]);

  const pickFromLibrary = async () => {
    if (!knowledge?.pickFromLibrary) return;
    const picked = await knowledge.pickFromLibrary();
    if (!picked.length) return;
    setAttachments(prev => {
      const existing = new Set(prev.map(a => a.id));
      const fresh = picked.filter(f => !existing.has(f.id)).map(attachmentFromFile);
      const next = [...prev, ...fresh];
      if (next.length > MAX_ATTACHMENTS) setFileError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return next.slice(0, MAX_ATTACHMENTS);
    });
  };

  const removeAttachment = (id: string) => {
    // Removing a chip while its file is still uploading cancels the upload too.
    const target = attachments.find(a => a.id === id);
    if (target?.file_id && target.status === 'uploading') knowledge?.cancelUpload?.(target.file_id);
    retryPlans.current.delete(id);
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const retryAttachment = (id: string) => {
    const plan = retryPlans.current.get(id);
    if (!plan) return;
    plan().catch(() => setFileError('Could not retry that file.'));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const accept = knowledge
    ? `${Object.keys(ACCEPTED_TYPES).filter(t => ACCEPTED_TYPES[t] === 'image').join(',')},${KNOWLEDGE_ACCEPT}`
    : Object.keys(ACCEPTED_TYPES).join(',');

  return (
    <div
      className="px-3 pt-1 sm:px-4 pb-safe"
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
    >
      <div className="max-w-3xl mx-auto">
        <div className={cn(
          'rounded-2xl glass border shadow-sm transition-colors',
          dragging ? 'border-accent bg-accent/5' : 'border-border focus-within:border-border-strong',
        )}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {attachments.map(a => (
                <AttachmentChip
                  key={a.id}
                  attachment={a}
                  progress={a.file_id ? knowledge?.progress?.[a.file_id] : undefined}
                  onRemove={() => removeAttachment(a.id)}
                  onRetry={() => retryAttachment(a.id)}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={dragging ? 'Drop files to attach' : 'Message Solo AI'}
            rows={1}
            disabled={disabled}
            aria-label="Message"
            className="w-full bg-transparent resize-none outline-none px-4 pt-3.5 pb-2 text-[0.95rem] text-fg placeholder:text-fg-subtle disabled:opacity-50 max-h-[220px]"
          />

          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <IconButton label="Attach files" size="sm" disabled={disabled || processing} onClick={() => fileInputRef.current?.click()} className="w-9 h-9">
                <Paperclip className="w-4 h-4" />
              </IconButton>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept={accept}
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              />
              {knowledge?.pickFromLibrary && (
                <IconButton label="Attach from your files" size="sm" disabled={disabled} onClick={pickFromLibrary} className="w-9 h-9">
                  <Library className="w-4 h-4" />
                </IconButton>
              )}
              {speech.supported && (
                <IconButton
                  label={speech.listening ? 'Stop voice input' : 'Voice input'}
                  size="sm"
                  active={speech.listening}
                  disabled={disabled}
                  onClick={speech.toggle}
                  className={cn('w-9 h-9', speech.listening ? 'text-danger bg-danger/10' : undefined)}
                >
                  {speech.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </IconButton>
              )}
            </div>

            {/* One control, two states: the arrow morphs into a stop square. */}
            <button
              type="button"
              onClick={isGenerating ? onStop : submit}
              disabled={!isGenerating && !canSend}
              aria-label={isGenerating ? 'Stop generating' : 'Send message'}
              title={isGenerating ? 'Stop generating' : 'Send message'}
              className="relative inline-flex items-center justify-center w-11 h-11 -m-0.5 rounded-full disabled:cursor-not-allowed"
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-0 m-auto flex items-center justify-center w-9 h-9 rounded-full bg-accent text-accent-fg shadow-sm transition-all duration-200',
                  isGenerating ? 'opacity-0 scale-50 rotate-90' : canSend ? 'opacity-100 scale-100 rotate-0' : 'opacity-40 scale-95 rotate-0',
                )}
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
              </span>
              <span
                aria-hidden
                className={cn(
                  'absolute inset-0 m-auto flex items-center justify-center w-9 h-9 rounded-full bg-fg text-bg shadow-md transition-all duration-200',
                  isGenerating ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 -rotate-90 pointer-events-none',
                )}
              >
                <Square className="w-3.5 h-3.5" fill="currentColor" />
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between min-h-[1.25rem] mt-1.5 px-1 text-[11px] text-fg-subtle">
          <span className={cn(fileError && 'text-danger')} aria-live="polite">
            {fileError || (speech.listening ? 'Listening…' : processing ? 'Reading files…' : pendingKnowledge ? 'Preparing files…' : hint || '')}
          </span>
          <span className="hidden sm:inline">
            {sendOnEnter ? 'Enter to send · Shift+Enter for a new line' : '⌘/Ctrl+Enter to send'}
          </span>
        </div>
      </div>
    </div>
  );
});

function AttachmentChip({ attachment, progress, onRemove, onRetry }: {
  attachment: Attachment;
  progress?: { sent: number; total: number };
  onRemove: () => void;
  onRetry: () => void;
}) {
  const isImage = attachment.type === 'image' && attachment.base64;
  const uploading = attachment.status === 'uploading';
  const busy = uploading || attachment.status === 'processing';
  const failed = attachment.status === 'failed';
  const ready = attachment.status === 'ready';
  const percent = uploading && progress && progress.total > 0 ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : null;
  const statusLabel = failed ? 'Failed' : uploading ? (percent === null ? 'Uploading' : `${percent}%`) : busy ? 'Processing' : ready ? 'Ready' : formatFileSize(attachment.size);
  return (
    <div
      className={cn(
        'relative overflow-hidden flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-lg border text-xs max-w-[260px] transition-colors',
        failed ? 'border-danger/40 bg-danger/10 text-fg'
          : ready ? 'border-success/40 bg-success/10 text-fg'
          : busy ? 'border-border bg-surface-2 text-fg-muted'
          : 'border-border bg-surface-2 text-fg-muted',
      )}
      title={failed ? attachment.error : undefined}
      data-file-status={attachment.status}
    >
      {percent !== null && (
        <span
          role="progressbar"
          aria-label={`Uploading ${attachment.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-accent/70 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      )}
      {isImage ? (
        <img src={`data:${attachment.mime_type};base64,${attachment.base64}`} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
      ) : attachment.type === 'image' ? (
        <ImageIcon className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />
      ) : uploading ? (
        <Loader2 className="w-4 h-4 text-fg-muted shrink-0 animate-spin-slow" aria-hidden />
      ) : attachment.status === 'processing' ? (
        <Loader2 className="w-4 h-4 text-accent shrink-0 animate-spin-slow" aria-hidden />
      ) : failed ? (
        <AlertCircle className="w-4 h-4 text-danger shrink-0" aria-hidden />
      ) : ready ? (
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden />
      ) : (
        <FileText className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />
      )}
      <span className="truncate max-w-[120px]">{attachment.name}</span>
      <span className="text-fg-muted shrink-0 tabular-nums" aria-live="polite">{statusLabel}</span>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Retry upload of ${attachment.name}`}
          title="Retry"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors shrink-0"
        >
          <RotateCcw className="w-3 h-3" aria-hidden />
        </button>
      )}
      <IconButton
        label={uploading ? `Cancel upload of ${attachment.name}` : `Remove ${attachment.name}`}
        size="sm"
        onClick={onRemove}
        className="w-6 h-6 shrink-0"
      >
        <X className="w-3 h-3" />
      </IconButton>
    </div>
  );
}
