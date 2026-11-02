import { useCallback, useEffect, useRef } from 'react';
import { pathFor, parsePath, type Route } from '../lib/routes';

interface Options {
  /** The route the UI is currently showing. */
  route: Route;
  /** True once the data needed to resolve a URL (chats, projects) has loaded. */
  ready: boolean;
  /** Show the given route in the UI (called for the first URL and for back/forward). */
  navigate: (route: Route) => void;
}

/**
 * Keeps the address bar and the UI in sync with the History API:
 * - the URL the page was opened with is applied once data is ready;
 * - UI changes push a new history entry;
 * - back/forward navigate the UI.
 */
export function useUrlRoute({ route, ready, navigate }: Options): void {
  const routePath = pathFor(route);
  const appliedRef = useRef(false);
  // Latest navigate without re-running the effects below on every identity change.
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    if (!ready || appliedRef.current) return;
    appliedRef.current = true;
    const initial = parsePath(window.location.pathname);
    if (pathFor(initial) !== '/') navigateRef.current(initial);
  }, [ready]);

  useEffect(() => {
    if (!ready || !appliedRef.current || window.location.pathname === routePath) return;
    window.history.pushState(null, '', routePath);
  }, [ready, routePath]);

  const onPop = useCallback(() => navigateRef.current(parsePath(window.location.pathname)), []);
  useEffect(() => {
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onPop]);
}
