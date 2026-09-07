import { Logo } from '../ui';
import { cn } from '../../lib/cn';

/** Assistant mark — the gold Solo "S", slightly cropped into a circle. */
export function AssistantAvatar({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 rounded-full ring-1 ring-accent/25', className)}>
      <Logo size={28} className="rounded-full" />
    </span>
  );
}

/** User initial — deliberately quiet so the gold stays with the assistant. */
export function UserAvatar({ initial, className }: { initial: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 w-7 h-7 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold uppercase text-fg-muted ring-1 ring-border',
        className,
      )}
    >
      {initial || 'Y'}
    </span>
  );
}
