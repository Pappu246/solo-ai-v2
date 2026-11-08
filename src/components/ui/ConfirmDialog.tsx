import { useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useT } from '../../lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{t(cancelLabel)}</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={handleConfirm} loading={busy} autoFocus>
            {t(confirmLabel)}
          </Button>
        </>
      }
    >
      {/* Body intentionally empty: title + description carry the content. */}
      <span className="sr-only">{description}</span>
    </Dialog>
  );
}
