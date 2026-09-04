import { CheckCircle2, AlertCircle, Loader2, UploadCloud } from 'lucide-react';
import type { FileStatus } from '../../types';
import { cn } from '../../lib/cn';
import { FILE_STATUS_LABEL } from '../../lib/knowledge/fileTypes';

/** Compact, token-coloured status pill used in lists and the detail dialog. */
export function FileStatusBadge({ status, className }: { status: FileStatus; className?: string }) {
  const Icon = status === 'ready' ? CheckCircle2 : status === 'failed' ? AlertCircle : status === 'uploading' ? UploadCloud : Loader2;
  const tone = status === 'ready' ? 'text-success' : status === 'failed' ? 'text-danger' : 'text-fg-muted';
  const busy = status === 'uploading' || status === 'processing';
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] font-medium', tone, className)}
      role="status"
      aria-live={busy ? 'polite' : undefined}
    >
      <Icon className={cn('w-3 h-3', busy && status === 'processing' && 'animate-spin-slow')} aria-hidden />
      {FILE_STATUS_LABEL[status]}
    </span>
  );
}
