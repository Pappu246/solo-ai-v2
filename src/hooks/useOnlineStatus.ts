/**
 * Phase 11: browser connectivity status.
 *
 * `navigator.onLine` is only a *hint* (it means "has a network interface",
 * not "can reach the server"), so we use it to warn early and to word errors
 * honestly — never as a hard gate: the request path still always tries and
 * maps its own failures.
 */
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Re-sync in case the state changed before listeners were attached.
    if (typeof navigator.onLine === 'boolean') setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
