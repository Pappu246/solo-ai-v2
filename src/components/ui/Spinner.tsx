import { cn } from '../../lib/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block rounded-full border-2 border-current border-t-transparent animate-spin-slow', className ?? 'w-4 h-4')}
    />
  );
}
