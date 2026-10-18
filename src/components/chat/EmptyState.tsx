import { ArrowUpRight, BookOpen, Code2, FileText, Lightbulb, Sparkles } from 'lucide-react';
import { Logo } from '../ui';

interface Props {
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  {
    icon: Code2,
    category: 'Develop',
    title: 'Write and debug code',
    description: 'Build a feature, understand an error, or add meaningful tests.',
    prompt: 'Help me write or debug code. Ask for any missing requirements, then propose a minimal implementation and relevant tests.',
  },
  {
    icon: BookOpen,
    category: 'Learn',
    title: 'Understand a difficult topic',
    description: 'Turn complex ideas into clear explanations and examples.',
    prompt: 'Explain a difficult topic in simple steps. Start with an intuitive analogy, then show a worked example and common mistakes.',
  },
  {
    icon: FileText,
    category: 'Analyze',
    title: 'Make sense of a document',
    description: 'Summarize key points, compare options, and surface actions.',
    prompt: 'Help me analyze a document. Ask me to attach or paste it first, then summarize its key findings, risks, and recommended actions.',
  },
  {
    icon: Lightbulb,
    category: 'Plan',
    title: 'Turn an idea into a plan',
    description: 'Break a goal into priorities, milestones, and next steps.',
    prompt: 'Help me turn an idea into an actionable plan. Clarify the goal if needed, then outline priorities, milestones, and practical next steps.',
  },
];

/**
 * A practical first-run workspace: clear hierarchy, real prompt actions,
 * and no account identifiers presented as a display name.
 */
export function EmptyState({ onSuggestion }: Props) {
  return (
    <div className="h-full min-h-[420px] flex items-center justify-center overflow-y-auto px-4 py-6 sm:px-8">
      <section className="w-full max-w-4xl animate-rise-in">
        <header className="flex items-center justify-between gap-4 border-b border-border/80 pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size={34} className="shrink-0 rounded-lg" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-fg">Solo AI</p>
              <p className="mt-0.5 text-xs text-fg-muted">Your AI workspace</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted sm:flex">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
            <span>Write · Build · Research · Plan</span>
          </div>
        </header>

        <div className="max-w-2xl pt-8 sm:pt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Start something new</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl lg:text-[2.7rem]">
            What would you like to get done?
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted sm:text-base">
            Choose a starting point below, or write your own request in the message box.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">Quick starts</h2>
          <p className="text-xs text-fg-subtle">Choose a card to start the conversation</p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.category}
              type="button"
              onClick={() => onSuggestion(suggestion.prompt)}
              className="group flex min-h-[132px] w-full items-start gap-4 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/45 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:p-5"
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-muted transition-colors group-hover:border-accent/25 group-hover:bg-accent/10 group-hover:text-accent">
                <suggestion.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                  {suggestion.category}
                </span>
                <span className="mt-1.5 block text-base font-semibold leading-snug text-fg">
                  {suggestion.title}
                </span>
                <span className="mt-1.5 block text-sm leading-5 text-fg-muted">
                  {suggestion.description}
                </span>
              </span>
              <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
            </button>
          ))}
        </div>

        <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-fg-subtle">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-[10px] font-semibold">↵</span>
          Your selected prompt is sent to Solo AI. You can also type any request below.
        </p>
      </section>
    </div>
  );
}
