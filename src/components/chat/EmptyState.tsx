import { BookOpen, Code2, FileText, Lightbulb } from 'lucide-react';
import { Logo } from '../ui';
import { useT } from '../../lib/i18n';

interface Props {
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  {
    icon: Code2,
    title: 'Write and debug code',
    prompt: 'Help me write or debug code. Ask for any missing requirements, then propose a minimal implementation and relevant tests.',
  },
  {
    icon: BookOpen,
    title: 'Understand a difficult topic',
    prompt: 'Explain a difficult topic in simple steps. Start with an intuitive analogy, then show a worked example and common mistakes.',
  },
  {
    icon: FileText,
    title: 'Make sense of a document',
    prompt: 'Help me analyze a document. Ask me to attach or paste it first, then summarize its key findings, risks, and recommended actions.',
  },
  {
    icon: Lightbulb,
    title: 'Turn an idea into a plan',
    prompt: 'Help me turn an idea into an actionable plan. Clarify the goal if needed, then outline priorities, milestones, and practical next steps.',
  },
];

/** Calm, centered first screen: one greeting and a few optional starting points. */
export function EmptyState({ onSuggestion }: Props) {
  const t = useT();
  return (
    <div className="h-full min-h-[360px] flex items-center justify-center overflow-y-auto px-4 py-6 sm:px-8">
      <section className="w-full max-w-2xl animate-rise-in text-center">
        <Logo size={40} className="mx-auto rounded-xl" />
        <h1 className="mt-6 font-display text-4xl leading-tight text-fg sm:text-5xl">
          {t('How can I help you today?')}
        </h1>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.title}
              type="button"
              onClick={() => onSuggestion(t(suggestion.prompt))}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <suggestion.icon className="h-4 w-4" aria-hidden />
              {t(suggestion.title)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
