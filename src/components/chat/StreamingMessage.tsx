import type { ModelInfo } from '../../types';
import { Markdown } from './Markdown';

interface Props {
  content: string;
  model?: ModelInfo | null;
  showModelBadge?: boolean;
}

/** Assistant reply in progress. Renders a typing indicator until the first token arrives. */
export function StreamingMessage({ content, model, showModelBadge }: Props) {
  if (!content) {
    return (
      <div className="flex items-center gap-1.5 h-6" role="status" aria-label="Solo AI is thinking">
        <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-fg-subtle" />
        <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-fg-subtle" />
        <span className="bounce-dot w-1.5 h-1.5 rounded-full bg-fg-subtle" />
        {model?.name && <span className="text-[11px] text-fg-subtle ml-1.5">{model.name}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite" aria-busy="true">
      <div className="text-fg">
        <Markdown content={content} live />
        <span className="typing-cursor" aria-hidden />
      </div>
      {showModelBadge && model?.name && <span className="text-[11px] text-fg-subtle">{model.name}</span>}
    </div>
  );
}
