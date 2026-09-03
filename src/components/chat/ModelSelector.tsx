import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Sparkles } from 'lucide-react';
import type { AIModel, ModelCategory } from '../../types';
import { MODEL_CATEGORIES } from '../../types';
import { cn } from '../../lib/cn';

interface Props {
  models: AIModel[];
  /** Explicit model id, or null for Auto. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}

/**
 * Model picker. "Auto" is the default and the recommended choice; the full
 * list is available for advanced users behind a single quiet control.
 */
export function ModelSelector({ models, selected, onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = selected ? models.find(m => m.id === selected) : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const grouped = models.reduce<Record<string, AIModel[]>>((acc, m) => { (acc[m.category] ||= []).push(m); return acc; }, {});
  const order: ModelCategory[] = ['conversation', 'fast', 'coding', 'reasoning', 'research', 'vision', 'creative', 'free'];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-lg text-sm font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-50"
      >
        {!current && <Sparkles className="w-3.5 h-3.5 text-accent" />}
        <span className="max-w-[140px] truncate">{current ? current.name : 'Auto'}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Model"
          className="absolute right-0 top-full mt-1.5 w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-lg p-1.5 z-40 animate-scale-in"
        >
          <Option
            selected={!selected}
            onClick={() => { onSelect(null); setOpen(false); }}
            title="Auto"
            subtitle="Solo picks the best model for each message"
            icon={<Sparkles className="w-3.5 h-3.5 text-accent" />}
          />
          {models.length === 0 && (
            <p className="px-3 py-3 text-xs text-fg-subtle">Model list unavailable. Auto still works.</p>
          )}
          {order.filter(c => grouped[c]?.length).map(cat => (
            <div key={cat} className="mt-1">
              <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{MODEL_CATEGORIES[cat]?.label ?? cat}</p>
              {grouped[cat].map(m => (
                <Option
                  key={m.id}
                  selected={selected === m.id}
                  onClick={() => { onSelect(m.id); setOpen(false); }}
                  title={m.name}
                  subtitle={[m.provider, m.supports_vision ? 'vision' : null, `${Math.round(m.context_length / 1000)}K context`].filter(Boolean).join(' · ')}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onClick, title, subtitle, icon }: { selected: boolean; onClick: () => void; title: string; subtitle: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn('w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', selected ? 'bg-accent/10' : 'hover:bg-surface-2')}
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-fg truncate">{title}</span>
        <span className="block text-[11px] text-fg-subtle truncate">{subtitle}</span>
      </span>
      {selected && <Check className="w-4 h-4 text-accent shrink-0" />}
    </button>
  );
}
