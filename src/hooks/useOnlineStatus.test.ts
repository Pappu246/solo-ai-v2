import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

describe('useOnlineStatus', () => {
  it('starts from the browser hint', () => {
    setOnline(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('assumes online when the hint is unavailable', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(undefined as unknown as boolean);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('follows online/offline events', () => {
    setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')); });
    expect(result.current).toBe(false);

    act(() => { setOnline(true); window.dispatchEvent(new Event('online')); });
    expect(result.current).toBe(true);
  });

  it('detaches listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));
  });
});
