import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { ArrowUp, Square, Paperclip, X, FileText, Image as ImageIcon, Mic, MicOff } from 'lucide-react';
import type { Attachment } from '../../types';
import { processFile, formatFileSize, ACCEPTED_TYPES, MAX_FILE_SIZE } from '../../lib/files';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { IconButton } from '../ui';
import { cn } from '../../lib/cn';

export interface ComposerHandle { focus: () => void }

interface Props {
  onSend: (message: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  isGenerating: boolean;
  sendOnEnter: boolean;
  disabled?: boolean;
  /** Short helper text under the box (e.g. active model). */
  hint?: string;
  autoFocus?: boolean;
}

const MAX_ATTACHMENTS = 6;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, onStop, isGenerating, sendOnEnter, disabled, hint, autoFocus }, ref,
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

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isGenerating && !disabled && !processing;

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(value.trim(), attachments.length ? attachments : undefined);
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

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setFileError(null);
    const list = Array.from(files);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setFileError(`You can attach up to ${MAX_ATTACHMENTS} files.`); return; }
    const errors: string[] = [];
    const accepted = list.filter(f => {
      if (!ACCEPTED_TYPES[f.type]) { errors.push(`${f.name}: unsupported type`); return false; }
      if (f.size > MAX_FILE_SIZE) { errors.push(`${f.name}: larger than 20 MB`); return false; }
      return true;
    }).slice(0, room);
    if (errors.length) setFileError(errors.join(' · '));
    if (!accepted.length) return;
    setProcessing(true);
    try {
      const processed = await Promise.all(accepted.map(processFile));
      setAttachments(prev => [...prev, ...processed]);
    } catch {
      setFileError('Could not read one of the files.');
    } finally { setProcessing(false); }
  }, [attachments.length]);

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

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
                accept={Object.keys(ACCEPTED_TYPES).join(',')}
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              />
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
            {fileError || (speech.listening ? 'Listening…' : processing ? 'Reading files…' : hint || '')}
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
  return (
    <div className="flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-lg border border-border bg-surface-2 text-xs text-fg max-w-[200px]">
      {isImage ? (
        <img src={`data:${attachment.mime_type};base64,${attachment.base64}`} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
      ) : attachment.type === 'image' ? (
        <ImageIcon className="w-4 h-4 text-fg-muted shrink-0" />
      ) : (
        <FileText className="w-4 h-4 text-fg-muted shrink-0" />
      )}
      <span className="truncate">{attachment.name}</span>
      <span className="text-fg-subtle shrink-0">{formatFileSize(attachment.size)}</span>
      <IconButton label={`Remove ${attachment.name}`} size="sm" onClick={onRemove} className="w-5 h-5"><X className="w-3 h-3" /></IconButton>
    </div>
  );
}
