import { useId } from 'react';
import { cn } from '../../lib/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Labelled switch. The whole row is the click target. */
export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  const descId = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <label htmlFor={id} className={cn('min-w-0 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
        <p className="text-sm font-medium text-fg">{label}</p>
        {description && <p id={descId} className="text-xs text-fg-muted mt-0.5">{description}</p>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative shrink-0 w-10 h-6 rounded-full transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          checked ? 'bg-accent' : 'bg-surface-3 border border-border-strong',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[18px] left-0.5' : 'translate-x-0 left-[1px]',
          )}
        />
      </button>
    </div>
  );
}
