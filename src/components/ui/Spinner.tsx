import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';

export function Spinner({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={t('Loading')}
      className={cn('inline-block rounded-full border-2 border-current border-t-transparent animate-spin-slow', className ?? 'w-4 h-4')}
    />
  );
}
