import { cn } from '../../lib/cn';

/** Solo AI mark: a single-stroke "S" arc — deliberately quiet, no gradient. */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex items-center justify-center rounded-lg bg-accent text-accent-fg shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.8 0-4.5 1.4-4.5 3.2 0 4.2 9 2 9 6.4 0 1.9-1.8 3.4-4.6 3.4-2.2 0-3.9-.9-4.7-2.2" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-semibold tracking-tight text-fg', className)}>Solo AI</span>;
}
