import { Logo } from '../ui';
import { useT } from '../../lib/i18n';

/** Calm, centered first screen: just the greeting. Everything else lives in the composer. */
export function EmptyState() {
  const t = useT();
  return (
    <div className="h-full min-h-[360px] flex items-center justify-center overflow-y-auto px-4 py-6 sm:px-8">
      <section className="w-full max-w-2xl animate-rise-in text-center">
        <Logo size={40} className="mx-auto rounded-xl" />
        <h1 className="mt-6 font-display text-4xl leading-tight text-fg sm:text-5xl">
          {t('How can I help you today?')}
        </h1>
      </section>
    </div>
  );
}
