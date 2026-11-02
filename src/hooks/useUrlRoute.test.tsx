import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlRoute } from './useUrlRoute';
import type { Route } from '../lib/routes';

const home: Route = { kind: 'chat', conversationId: null };

describe('useUrlRoute', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('applies the opening URL once, after data is ready', () => {
    window.history.replaceState(null, '', '/memory');
    const navigate = vi.fn();
    const { rerender } = renderHook(({ ready }) => useUrlRoute({ route: home, ready, navigate }), { initialProps: { ready: false } });
    expect(navigate).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(navigate).toHaveBeenCalledWith({ kind: 'memory' });
    rerender({ ready: true });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not navigate for the home URL', () => {
    const navigate = vi.fn();
    renderHook(() => useUrlRoute({ route: home, ready: true, navigate }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('pushes a history entry when the UI route changes', () => {
    const navigate = vi.fn();
    const { rerender } = renderHook(({ route }) => useUrlRoute({ route, ready: true, navigate }), { initialProps: { route: home as Route } });
    rerender({ route: { kind: 'files' } });
    expect(window.location.pathname).toBe('/files');
  });

  it('navigates the UI on back/forward', () => {
    const navigate = vi.fn();
    renderHook(() => useUrlRoute({ route: home, ready: true, navigate }));
    act(() => {
      window.history.replaceState(null, '', '/files');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(navigate).toHaveBeenCalledWith({ kind: 'files' });
  });

  it('removes the popstate listener on unmount', () => {
    const navigate = vi.fn();
    const { unmount } = renderHook(() => useUrlRoute({ route: home, ready: true, navigate }));
    unmount();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
