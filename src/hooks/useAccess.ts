import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { requestAccess, type AccessStatus } from '../lib/access';

export type AccessState = AccessStatus | 'checking';

const RECHECK_MS = 20_000;

/** Asks the server whether the signed-in user may use the app; re-checks while pending. */
export function useAccess(user: User | null) {
  const [status, setStatus] = useState<AccessState>('checking');
  const userId = user?.id ?? null;

  const check = useCallback(async () => {
    if (!userId) return;
    setStatus(await requestAccess());
  }, [userId]);

  useEffect(() => {
    if (!userId) { setStatus('checking'); return; }
    let cancelled = false;
    requestAccess().then(s => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setInterval(() => { void check(); }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [status, check]);

  return { status, recheck: check };
}
