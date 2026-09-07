import { Code2, PenLine, BookOpen, Lightbulb } from 'lucide-react';
import { Logo } from '../ui';

interface Props {
  onSuggestion: (text: string) => void;
  userName?: string;
}

const SUGGESTIONS = [
  { icon: Code2,     label: 'Write code',   text: 'Write a TypeScript function that debounces another function, with tests.' },
  { icon: PenLine,   label: 'Draft',        text: 'Draft a concise, friendly email asking my team for status updates by Friday.' },
  { icon: BookOpen,  label: 'Explain',      text: 'Explain how transformer attention works, using a simple analogy first.' },
  { icon: Lightbulb, label: 'Brainstorm',   text: 'Give me 10 project ideas for learning full-stack development, ranked by difficulty.' },
];

function greetingFor(hour: number) {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The cinematic landing: a gold wash, a serif greeting, quiet suggestion cards. */
export function EmptyState({ onSuggestion, userName }: Props) {
  const name = userName?.split('@')[0];
  return (
    <div className="h-full flex items-center justify-center px-4 relative overflow-y-auto">
      {/* Ambient glow behind the greeting (dark theme only). */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[42rem] h-[26rem] rounded-full opacity-70 dark:opacity-100"
        style={{ background: 'radial-gradient(closest-side, rgb(var(--accent) / 0.14), transparent 70%)' }}
      />
      <div className="w-full max-w-2xl text-center animate-rise-in relative">
        <div className="relative inline-flex mb-6">
          <span
            aria-hidden
            className="absolute inset-0 -m-6 rounded-full opacity-90 dark:opacity-100"
            style={{ background: 'radial-gradient(closest-side, rgb(var(--accent) / 0.35), transparent 72%)' }}
          />
          <Logo size={52} className="relative rounded-xl shadow-lg" />
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-normal tracking-tight text-fg">
          {greetingFor(new Date().getHours())}{name ? <span className="text-accent">, {name}</span> : ''}
        </h1>
        <p className="text-fg-muted mt-3 text-[0.95rem]">What would you like to get done?</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-10 text-left">
          {SUGGESTIONS.map(s => (
            <button
              key={s.label}
              type="button"
              onClick={() => onSuggestion(s.text)}
              className="group glass-card flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200 ease-[var(--ease-soft)] hover:-translate-y-1 hover:border-accent/60 hover:ring-1 hover:ring-accent/45 hover:shadow-[0_2px_6px_rgb(0_0_0/0.2),0_16px_32px_rgb(0_0_0/0.35)] dark:hover:shadow-[0_2px_6px_rgb(0_0_0/0.55),0_20px_44px_rgb(0_0_0/0.65)]"
            >
              <s.icon className="w-4 h-4 text-fg-muted mt-0.5 shrink-0 group-hover:text-accent transition-colors" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg-subtle uppercase tracking-wider">{s.label}</span>
                <span className="block text-sm text-fg mt-1 leading-snug">{s.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
