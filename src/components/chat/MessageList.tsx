import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Message as MessageType, ModelInfo, KnowledgeSource } from '../../types';
import type { FriendlyError } from '../../lib/errors';
import { Message } from './Message';
import { StreamingMessage } from './StreamingMessage';
import { ErrorCard } from './ErrorCard';
import { Spinner } from '../ui';

interface Props {
  messages: MessageType[];
  loading?: boolean;
  isGenerating: boolean;
  streamingContent: string;
  streamingModel: ModelInfo | null;
  error: FriendlyError | null;
  canRetry: boolean;
  showModelBadge: boolean;
  ttsEnabled: boolean;
  ttsRate: number;
  onRegenerate: () => void;
  onEdit: (id: string, content: string) => void;
  onRetry: () => void;
  onDismissError: () => void;
  onRemember?: (content: string) => void;
  onOpenSource?: (source: KnowledgeSource) => void;
}

const NEAR_BOTTOM_PX = 120;

export function MessageList({
  messages, loading, isGenerating, streamingContent, streamingModel, error, canRetry,
  showModelBadge, ttsEnabled, ttsRate, onRegenerate, onEdit, onRetry, onDismissError, onRemember, onOpenSource,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottom.current = distance < NEAR_BOTTOM_PX;
    setShowJump(distance > 300);
  }, []);

  // Follow the stream only while the user is already at the bottom.
  useEffect(() => {
    if (pinnedToBottom.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streamingContent, error]);

  // Always jump to the bottom when switching conversations.
  const conversationKey = messages[0]?.conversation_id;
  useEffect(() => {
    pinnedToBottom.current = true;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [conversationKey]);

  const lastAssistantIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i; return -1; })();

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6">
          {loading && messages.length === 0 && (
            <div className="flex justify-center py-10 text-fg-subtle"><Spinner /></div>
          )}
          {messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              isLast={i === lastAssistantIdx && i === messages.length - 1}
              disabled={isGenerating}
              showModelBadge={showModelBadge}
              ttsEnabled={ttsEnabled}
              ttsRate={ttsRate}
              onRegenerate={m.role === 'assistant' ? onRegenerate : undefined}
              onEdit={m.role === 'user' ? onEdit : undefined}
              onRemember={m.role === 'assistant' ? onRemember : undefined}
              onOpenSource={onOpenSource}
            />
          ))}
          {isGenerating && <StreamingMessage content={streamingContent} model={streamingModel} showModelBadge={showModelBadge} />}
          {error && !isGenerating && (
            <ErrorCard error={error} onRetry={canRetry && error.retryable ? onRetry : undefined} onDismiss={onDismissError} />
          )}
          <div ref={endRef} className="h-px" />
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => { pinnedToBottom.current = true; endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }}
          aria-label="Scroll to latest"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center justify-center w-8 h-8 rounded-full border border-border bg-surface shadow-md text-fg-muted hover:text-fg animate-fade-in"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
