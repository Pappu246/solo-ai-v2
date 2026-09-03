import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Copy, Check, RefreshCw, Pencil, Volume2, Square, FileText, Image as ImageIcon } from 'lucide-react';
import type { Message as MessageType, Attachment } from '../../types';
import { Markdown } from './Markdown';
import { IconButton, Button } from '../ui';
import { speak, stop as stopSpeaking, isSpeaking } from '../../lib/tts';
import { cn } from '../../lib/cn';

interface MessageProps {
  message: MessageType;
  isLast?: boolean;
  disabled?: boolean;
  showModelBadge?: boolean;
  ttsEnabled?: boolean;
  ttsRate?: number;
  onRegenerate?: () => void;
  onEdit?: (id: string, content: string) => void;
}

export const Message = memo(function Message({
  message, isLast, disabled, showModelBadge = true, ttsEnabled = true, ttsRate = 1, onRegenerate, onEdit,
}: MessageProps) {
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1.5" data-role="user">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {message.attachments.map(a => <AttachmentPill key={a.id} attachment={a} />)}
          </div>
        )}
        {editing && onEdit ? (
          <EditBox
            initial={message.content}
            onCancel={() => setEditing(false)}
            onSave={text => { setEditing(false); onEdit(message.id, text); }}
          />
        ) : (
          <>
            {message.content && (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 border border-border px-4 py-2.5 text-[0.95rem] leading-relaxed text-fg whitespace-pre-wrap break-words">
                {message.content}
              </div>
            )}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <CopyButton text={message.content} />
              {onEdit && (
                <IconButton label="Edit message" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
                  <Pencil className="w-3.5 h-3.5" />
                </IconButton>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1.5" data-role="assistant">
      <div className="text-fg">
        <Markdown content={message.content} />
      </div>
      <div className={cn(
        'flex items-center gap-0.5 transition-opacity',
        isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
      )}>
        <CopyButton text={message.content} />
        {ttsEnabled && <SpeakButton text={message.content} rate={ttsRate} />}
        {onRegenerate && isLast && (
          <IconButton label="Regenerate response" size="sm" disabled={disabled} onClick={onRegenerate}>
            <RefreshCw className="w-3.5 h-3.5" />
          </IconButton>
        )}
        {showModelBadge && message.model && (
          <span className="ml-1.5 text-[11px] text-fg-subtle truncate" title={`Answered by ${message.model_name || message.model}`}>
            {message.model_name || message.model}
          </span>
        )}
      </div>
    </div>
  );
});

// ── Pieces ─────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard unavailable */ }
  }, [text]);
  return (
    <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={copy}>
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
    </IconButton>
  );
}

function SpeakButton({ text, rate }: { text: string; rate: number }) {
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const toggle = useCallback(() => {
    if (speaking) { stopSpeaking(); setSpeaking(false); if (timer.current) window.clearInterval(timer.current); return; }
    speak(text, rate);
    setSpeaking(true);
    timer.current = window.setInterval(() => {
      if (!isSpeaking()) { setSpeaking(false); if (timer.current) window.clearInterval(timer.current); }
    }, 400);
  }, [speaking, text, rate]);

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return (
    <IconButton label={speaking ? 'Stop reading' : 'Read aloud'} size="sm" active={speaking} onClick={toggle}>
      {speaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
    </IconButton>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.setSelectionRange(value.length, value.length); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const canSave = value.trim().length > 0 && value.trim() !== initial.trim();
  return (
    <div className="w-full max-w-[85%] rounded-2xl border border-accent/40 bg-surface p-2">
      <textarea
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSave) onSave(value);
        }}
        rows={Math.min(8, Math.max(2, value.split('\n').length))}
        className="w-full bg-transparent resize-none outline-none text-[0.95rem] text-fg px-2 py-1"
        aria-label="Edit your message"
      />
      <div className="flex items-center justify-end gap-2 mt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} onClick={() => onSave(value)}>Save & resend</Button>
      </div>
    </div>
  );
}

function AttachmentPill({ attachment }: { attachment: Attachment }) {
  const isImage = attachment.type === 'image';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-fg-muted max-w-[220px]">
      {isImage ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">{attachment.name}</span>
    </span>
  );
}
