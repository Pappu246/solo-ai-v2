import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { FriendlyError } from '../../lib/errors';
import { Button } from '../ui';

interface Props {
  error: FriendlyError;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/** Humane error card: plain-language message with expandable technical detail. */
export function ErrorCard({ error, onRetry, onDismiss }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-fg">{error.title}</p>
          <p className="text-sm text-fg-muted mt-0.5">{error.message}</p>
          {error.detail && error.detail !== error.message && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted"
              >
                {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Details
              </button>
              {open && <pre className="mt-1.5 text-[11px] text-fg-muted whitespace-pre-wrap break-words font-mono bg-surface rounded-lg border border-border p-2.5 max-h-40 overflow-auto">{error.detail}</pre>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}
          {onRetry && error.retryable && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
        </div>
      </div>
    </div>
  );
}
