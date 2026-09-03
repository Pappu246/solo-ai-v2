import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded border border-border bg-surface-2 text-[10px] font-medium text-fg-muted font-sans">
      {children}
    </kbd>
  );
}
