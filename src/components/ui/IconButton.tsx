import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Required — icon-only buttons must be labelled. */
  label: string;
  /** sm = 28px, md = 36px, lg = 44px (touch-target size). */
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  tone?: 'default' | 'danger';
  /** Position of tooltip relative to button. Defaults to 'top'. */
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  /** Disable visual tooltip popup (e.g. when used in crowded menus or custom title handling). */
  showTooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    size = 'md',
    active,
    tone = 'default',
    tooltipPosition = 'top',
    showTooltip = true,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const sizes = { sm: 'w-7 h-7', md: 'w-9 h-9', lg: 'w-11 h-11' };

  const tooltipPositions = {
    top: 'bottom-full mb-1.5 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-1.5 left-1/2 -translate-x-1/2',
    left: 'right-full mr-1.5 top-1/2 -translate-y-1/2',
    right: 'left-full ml-1.5 top-1/2 -translate-y-1/2',
  };

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={showTooltip ? undefined : label}
      aria-pressed={active}
      className={cn(
        'group/tooltip relative inline-flex items-center justify-center rounded-lg transition-colors',
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
    >
      {rest.children}
      {showTooltip && (
        <span
          role="tooltip"
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-[11px] font-medium text-fg shadow-md border border-border/60',
            'opacity-0 scale-95 transition-all duration-150 ease-out',
            'group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100',
            'group-focus-visible/tooltip:opacity-100 group-focus-visible/tooltip:scale-100',
            tooltipPositions[tooltipPosition],
          )}
        >
          {label}
        </span>
      )}
    </button>
  );
});
