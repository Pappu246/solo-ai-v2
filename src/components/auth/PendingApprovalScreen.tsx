import { useState } from 'react';
import { Clock, ShieldOff } from 'lucide-react';
import { Button, Logo } from '../ui';

interface Props {
  blocked: boolean;
  email?: string;
  onRecheck: () => Promise<void> | void;
  onSignOut: () => void;
}

/** Shown to a signed-in user who has not been approved (or has been turned off). */
export function PendingApprovalScreen({ blocked, email, onRecheck, onSignOut }: Props) {
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try { await onRecheck(); } finally { setChecking(false); }
  };
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div role="status" className="w-full max-w-md rounded-2xl glass border border-border float-shadow p-6 text-center">
        <div className="flex justify-center"><Logo size={36} /></div>
        <div className="mt-4 flex justify-center text-fg-muted">
          {blocked ? <ShieldOff className="w-6 h-6" aria-hidden /> : <Clock className="w-6 h-6" aria-hidden />}
        </div>
        <h1 className="mt-3 text-lg font-semibold text-fg">{blocked ? 'Access turned off' : 'Waiting for approval'}</h1>
        <p className="mt-2 text-sm text-fg-muted leading-relaxed">
          {blocked
            ? 'The owner has turned off access for this account.'
            : <>Your request{email ? <> for <span className="text-fg">{email}</span></> : null} has been sent. You can use Solo AI as soon as the owner approves it. This page updates by itself.</>}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {!blocked && <Button variant="primary" onClick={recheck} loading={checking}>Check again</Button>}
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}
