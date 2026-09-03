import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Required — icon-only buttons must be labelled. */
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  tone?: 'default' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, tone = 'default', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        size === 'sm' ? 'w-7 h-7' : 'w-9 h-9',
        tone === 'danger'
          ? 'text-fg-muted hover:text-danger hover:bg-danger/10'
          : active
            ? 'text-accent bg-accent/10'
            : 'text-fg-muted hover:text-fg hover:bg-surface-2',
        className,
      )}
      {...rest}
    />
  );
});
