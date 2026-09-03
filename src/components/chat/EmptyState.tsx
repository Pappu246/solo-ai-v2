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

export function EmptyState({ onSuggestion, userName }: Props) {
  const name = userName?.split('@')[0];
  return (
    <div className="h-full flex items-center justify-center px-4">
      <div className="w-full max-w-2xl text-center animate-fade-up">
        <Logo size={40} className="mx-auto mb-5" />
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-fg">
          {greetingFor(new Date().getHours())}{name ? `, ${name}` : ''}
        </h1>
        <p className="text-fg-muted mt-2">What would you like to get done?</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8 text-left">
          {SUGGESTIONS.map(s => (
            <button
              key={s.label}
              type="button"
              onClick={() => onSuggestion(s.text)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-surface hover:bg-surface-2 hover:border-border-strong p-3.5 transition-colors text-left"
            >
              <s.icon className="w-4 h-4 text-fg-muted mt-0.5 shrink-0 group-hover:text-accent transition-colors" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg-subtle">{s.label}</span>
                <span className="block text-sm text-fg mt-0.5 leading-snug">{s.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
