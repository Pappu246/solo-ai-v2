import type { ModelInfo } from '../../types';
import { Markdown } from './Markdown';
import { AssistantAvatar } from './Avatar';

interface Props {
  content: string;
  model?: ModelInfo | null;
  showModelBadge?: boolean;
}

/** Assistant reply in progress. Renders a typing indicator until the first token arrives. */
export function StreamingMessage({ content, model, showModelBadge }: Props) {
  if (!content) {
    return (
      <div className="flex items-start gap-2.5" aria-busy="true">
        <AssistantAvatar className="mt-0.5" />
        <div
          role="status"
          aria-label="Solo AI is thinking"
          className="flex items-center gap-1.5 h-9 px-4 rounded-2xl rounded-tl-md bg-surface-2/60 border border-border"
        >
          <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-accent" />
          {model?.name && <span className="text-[11px] text-fg-subtle ml-1.5">{model.name}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5" aria-live="polite" aria-busy="true">
      <AssistantAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md bg-surface-2/60 border border-border px-4 py-3">
          <div className="text-fg">
            <Markdown content={content} live />
            <span className="typing-cursor" aria-hidden />
          </div>
        </div>
        {showModelBadge && model?.name && <span className="block mt-1 text-[11px] text-fg-subtle">{model.name}</span>}
      </div>
    </div>
  );
}
