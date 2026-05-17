import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Paperclip, X, FileText, Image, Mic, MicOff } from 'lucide-react';
import type { Attachment } from '../types';
import { processFile, formatFileSize, ACCEPTED_TYPES, MAX_FILE_SIZE } from '../lib/files';

interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionEventType extends Event {
  resultIndex: number;
  results: ArrayLike<ArrayLike<SpeechRecognitionResultItem>>;
}

interface Props {
  onSend: (message: string, attachments?: Attachment[]) => void;
  isLoading: boolean;
  onStop: () => void;
  autoRoute: boolean;
  selectedModel: string | null;
  disabled?: boolean;
}

export function ChatInput({ onSend, isLoading, onStop, autoRoute, selectedModel, disabled }: Props) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<unknown>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px';
  }, [input]);

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || isLoading || disabled) return;
    onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, attachments, isLoading, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // File handling
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setFileError(null);
    const fileArr = Array.from(files);
    const toProcess = fileArr.filter(f => {
      if (!ACCEPTED_TYPES[f.type]) { setFileError(`Unsupported file type: ${f.name}`); return false; }
      if (f.size > MAX_FILE_SIZE) { setFileError(`File too large: ${f.name} (max 20MB)`); return false; }
      return true;
    });
    const processed = await Promise.all(toProcess.map(processFile));
    setAttachments(prev => [...prev, ...processed]);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  // Drag and drop
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  // Voice input
  const toggleRecording = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: Event) => {
      const event = e as unknown as SpeechRecognitionEventType;
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
      setIsRecording(false);
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, [isRecording]);

  const canSend = (input.trim() || attachments.length > 0) && !isLoading && !disabled;

  return (
    <div
      className={`p-3 border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm transition-all duration-200 ${isDragging ? 'bg-amber-500/5 border-amber-500/30' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="max-w-3xl mx-auto">
        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map(att => (
              <AttachmentChip key={att.id} attachment={att} onRemove={() => removeAttachment(att.id)} />
            ))}
          </div>
        )}

        {/* Error */}
        {fileError && (
          <div className="text-red-400 text-xs mb-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
            {fileError}
          </div>
        )}

        {isDragging && (
          <div className="text-amber-400 text-xs mb-2 text-center">Drop files here</div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 w-10 h-10 rounded-xl border border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 flex items-center justify-center transition-all duration-200 mb-0.5"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={onFileInput} className="hidden"
            accept={Object.keys(ACCEPTED_TYPES).join(',')} />

          {/* Textarea */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isDragging ? 'Drop files here…' : 'Message SOLO AI… (Shift+Enter for newline)'}
              rows={1}
              disabled={disabled}
              className="w-full bg-zinc-900/80 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 input-focus resize-none transition-all duration-200 disabled:opacity-50"
            />
          </div>

          {/* Voice button */}
          <button
            onClick={toggleRecording}
            className={`flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-all duration-200 mb-0.5 ${
              isRecording
                ? 'bg-red-500/20 border-red-500/40 text-red-400'
                : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
            title={isRecording ? 'Stop recording' : 'Voice input'}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Send/Stop */}
          {isLoading ? (
            <button
              onClick={onStop}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 flex items-center justify-center transition-all duration-200 mb-0.5"
              title="Stop generation"
            >
              <Square className="w-4 h-4" fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 shadow-md shadow-amber-500/20 mb-0.5"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-400' : 'bg-emerald-400'} ${isLoading ? '' : 'animate-pulse'}`} />
            <span className="text-[10px] text-zinc-600">
              {isLoading ? 'Generating…' : autoRoute && !selectedModel ? 'Auto-routing' : selectedModel || 'Auto'}
            </span>
          </div>
          <span className="text-[10px] text-zinc-700">Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/40 text-xs text-zinc-300 max-w-[180px]">
      {attachment.type === 'image' ? (
        attachment.base64 ? (
          <img src={`data:${attachment.mime_type};base64,${attachment.base64}`} alt={attachment.name} className="w-5 h-5 rounded object-cover flex-shrink-0" />
        ) : (
          <Image className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
        )
      ) : (
        <FileText className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
      )}
      <span className="truncate">{attachment.name}</span>
      <span className="text-zinc-600 flex-shrink-0">{formatFileSize(attachment.size)}</span>
      <button onClick={onRemove} className="text-zinc-500 hover:text-red-400 transition-colors flex-shrink-0">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
