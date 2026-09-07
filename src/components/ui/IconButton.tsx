import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Required — icon-only buttons must be labelled. */
  label: string;
  /** sm = 28px, md = 36px, lg = 44px (touch-target size). */
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  tone?: 'default' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, tone = 'default', className, type = 'button', ...rest },
  ref,
) {
  const sizes = { sm: 'w-7 h-7', md: 'w-9 h-9', lg: 'w-11 h-11' };
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
        sizes[size],
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
