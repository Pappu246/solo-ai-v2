import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button, Logo } from '../ui';
import { DecisionError, sendDecision, type DecisionPreview } from '../../lib/access';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: DecisionPreview }
  | { kind: 'done'; preview: DecisionPreview }
  | { kind: 'error'; message: string };

/**
 * Opened from the owner's email (`/?approve=<token>`). The signed token is the
 * authorization, so no sign-in is needed. Nothing changes until the button is
 * pressed, which keeps email link scanners from approving anyone.
 */
export function ApproveScreen({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendDecision(token, false)
      .then(preview => { if (!cancelled) setPhase({ kind: 'ready', preview }); })
      .catch(e => { if (!cancelled) setPhase({ kind: 'error', message: (e as Error).message }); });
    return () => { cancelled = true; };
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try { setPhase({ kind: 'done', preview: await sendDecision(token, true) }); }
    catch (e) { setPhase({ kind: 'error', message: e instanceof DecisionError ? e.message : 'Something went wrong.' }); }
    finally { setBusy(false); }
  };

  const approving = (p: DecisionPreview) => p.decision === 'approve';
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl glass border border-border float-shadow p-6 text-center">
        <div className="flex justify-center"><Logo size={36} /></div>
        {phase.kind === 'loading' && <p className="mt-4 text-sm text-fg-muted" aria-busy="true">Checking link…</p>}
        {phase.kind === 'error' && (
          <>
            <XCircle className="mx-auto mt-4 w-6 h-6 text-danger" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold text-fg">Can’t use this link</h1>
            <p role="alert" className="mt-2 text-sm text-fg-muted">{phase.message}</p>
          </>
        )}
        {phase.kind === 'ready' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">{approving(phase.preview) ? 'Approve access?' : 'Reject access?'}</h1>
            <p className="mt-2 text-sm text-fg-muted"><span className="text-fg">{phase.preview.email || 'This user'}</span> asked to use Solo AI.</p>
            <div className="mt-5 flex justify-center">
              <Button variant={approving(phase.preview) ? 'primary' : 'danger'} loading={busy} onClick={confirm}>
                {approving(phase.preview) ? 'Yes, approve' : 'Yes, reject'}
              </Button>
            </div>
          </>
        )}
        {phase.kind === 'done' && (
          <>
            <CheckCircle2 className="mx-auto mt-4 w-6 h-6 text-fg-muted" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold text-fg">{approving(phase.preview) ? 'Approved' : 'Rejected'}</h1>
            <p className="mt-2 text-sm text-fg-muted">{phase.preview.email || 'The user'} {approving(phase.preview) ? 'can now use Solo AI.' : 'can no longer use Solo AI.'}</p>
          </>
        )}
      </div>
    </main>
  );
}
