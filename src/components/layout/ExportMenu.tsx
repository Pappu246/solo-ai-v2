import { useEffect, useRef, useState } from 'react';
import { Download, FileText, FileType2 } from 'lucide-react';
import { IconButton } from '../ui';
import { useT } from '../../lib/i18n';

interface Props {
  onMarkdown: () => void;
  onPdf: () => void;
}

/** Export button with a small menu: Markdown file or PDF (via the print dialog). */
export function ExportMenu({ onMarkdown, onPdf }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-sm text-fg text-left rounded-lg hover:bg-surface-2/60 focus-visible:bg-surface-2/60 outline-hidden';

  return (
    <div ref={root} className="relative">
      <IconButton label="Export chat" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} showTooltip={!open} tooltipPosition="bottom"><Download className="w-4 h-4" /></IconButton>
      {open && (
        <div role="menu" aria-label={t('Export chat')} className="absolute right-0 top-full mt-1.5 z-40 w-56 p-1 rounded-xl border border-border bg-surface shadow-lg">
          <button type="button" role="menuitem" className={item} onClick={pick(onPdf)}><FileType2 className="w-4 h-4 text-fg-muted" aria-hidden="true" />{t('Save as PDF')}</button>
          <button type="button" role="menuitem" className={item} onClick={pick(onMarkdown)}><FileText className="w-4 h-4 text-fg-muted" aria-hidden="true" />{t('Download Markdown (.md)')}</button>
        </div>
      )}
    </div>
  );
}
