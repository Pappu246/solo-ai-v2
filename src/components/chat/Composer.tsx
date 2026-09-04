import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { ArrowUp, Square, Paperclip, X, FileText, Image as ImageIcon, Mic, MicOff, Library, AlertCircle, Loader2 } from 'lucide-react';
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
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [canSend, onSend, value, attachments]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const wantsSend = sendOnEnter ? !e.shiftKey : (e.metaKey || e.ctrlKey);
    if (wantsSend) { e.preventDefault(); submit(); }
  };

  const upsertAttachment = useCallback((f: KnowledgeFile) => {
    setAttachments(prev => {
      const next = attachmentFromFile(f);
      return prev.some(a => a.id === next.id) ? prev.map(a => (a.id === next.id ? next : a)) : [...prev, next];
    });
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setFileError(null);
    const list = Array.from(files);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setFileError(`You can attach up to ${MAX_ATTACHMENTS} files.`); return; }
    const errors: string[] = [];
    const images: File[] = [];
    const documents: File[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_SIZE) { errors.push(`${f.name}: larger than 20 MB`); continue; }
      if (ACCEPTED_TYPES[f.type] === 'image') { images.push(f); continue; }
      if (knowledge && detectFileType(f)) { documents.push(f); continue; }
      if (!knowledge && ACCEPTED_TYPES[f.type]) { documents.push(f); continue; }
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
        // Runs in the background; chips update as each file moves through its lifecycle.
        knowledge.upload(knowledgeFiles, upsertAttachment).catch(() => setFileError('Could not upload one of the files.'));
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

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const accept = knowledge
    ? `${Object.keys(ACCEPTED_TYPES).filter(t => ACCEPTED_TYPES[t] === 'image').join(',')},${KNOWLEDGE_ACCEPT}`
    : Object.keys(ACCEPTED_TYPES).join(',');

  return (
    <div
      className="px-3 pb-3 pt-1 sm:px-4 sm:pb-4"
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
    >
      <div className="max-w-3xl mx-auto">
        <div className={cn(
          'rounded-2xl border bg-surface shadow-sm transition-colors',
          dragging ? 'border-accent bg-accent/5' : 'border-border focus-within:border-border-strong',
        )}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {attachments.map(a => <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />)}
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
              <IconButton label="Attach files" size="sm" disabled={disabled || processing} onClick={() => fileInputRef.current?.click()}>
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
                <IconButton label="Attach from your files" size="sm" disabled={disabled} onClick={pickFromLibrary}>
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
                  className={speech.listening ? 'text-danger bg-danger/10' : undefined}
                >
                  {speech.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </IconButton>
              )}
            </div>

            {isGenerating ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-fg text-bg hover:opacity-90 transition-opacity"
              >
                <Square className="w-3.5 h-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
                title="Send message"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent text-accent-fg hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between min-h-[1.25rem] mt-1.5 px-1 text-[11px] text-fg-subtle">
          <span className={cn(fileError && 'text-danger')}>
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

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const isImage = attachment.type === 'image' && attachment.base64;
  const busy = attachment.status === 'uploading' || attachment.status === 'processing';
  const failed = attachment.status === 'failed';
  return (
    <div
      className={cn('flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-lg border text-xs text-fg max-w-[220px]', failed ? 'border-danger/30 bg-danger/5' : 'border-border bg-surface-2')}
      title={failed ? attachment.error : undefined}
    >
      {isImage ? (
        <img src={`data:${attachment.mime_type};base64,${attachment.base64}`} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
      ) : attachment.type === 'image' ? (
        <ImageIcon className="w-4 h-4 text-fg-muted shrink-0" />
      ) : busy ? (
        <Loader2 className="w-4 h-4 text-fg-muted shrink-0 animate-spin-slow" aria-label={attachment.status === 'uploading' ? 'Uploading' : 'Processing'} />
      ) : failed ? (
        <AlertCircle className="w-4 h-4 text-danger shrink-0" aria-label="Failed" />
      ) : (
        <FileText className="w-4 h-4 text-fg-muted shrink-0" />
      )}
      <span className="truncate">{attachment.name}</span>
      <span className="text-fg-subtle shrink-0">{failed ? 'Failed' : busy ? (attachment.status === 'uploading' ? 'Uploading' : 'Processing') : formatFileSize(attachment.size)}</span>
      <IconButton label={`Remove ${attachment.name}`} size="sm" onClick={onRemove} className="w-5 h-5"><X className="w-3 h-3" /></IconButton>
    </div>
  );
}
