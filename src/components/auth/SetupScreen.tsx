import { Logo } from '../ui';

/** Shown instead of a blank page when the browser-safe Supabase config is missing. */
export function SetupScreen() {
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <h1 className="text-lg font-semibold text-fg">Solo AI needs configuration</h1>
        </div>
        <p className="mt-3 text-sm text-fg-muted leading-relaxed">
          The Supabase connection isn’t configured for this build. Create a <code className="font-mono text-fg">.env</code> file
          from <code className="font-mono text-fg">.env.example</code> with:
        </p>
        <pre className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-xs font-mono text-fg overflow-x-auto">{`VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}</pre>
        <p className="mt-3 text-xs text-fg-subtle">Then restart the dev server. AI provider keys belong only in Supabase Edge Function secrets — never in the browser.</p>
      </div>
    </main>
  );
}
