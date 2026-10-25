import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock('../lib/supabase', () => ({ supabase: { auth: { updateUser: (...a: unknown[]) => updateUser(...a) } } }));

import { useSettings } from './useSettings';

const user = (meta?: Record<string, unknown>) => ({ id: 'u1', user_metadata: meta ?? {} }) as never;

describe('useSettings sync', () => {
  beforeEach(() => { vi.useFakeTimers(); updateUser.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('pulls saved settings on sign-in and applies them', () => {
    const { result } = renderHook(() => useSettings(user({ solo_settings: { theme: 'dark', font_size: 'lg' } })));
    expect(result.current.settings.theme).toBe('dark');
    expect(result.current.settings.font_size).toBe('lg');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('uploads this device\'s settings when none are saved yet', () => {
    renderHook(() => useSettings(user()));
    act(() => { vi.advanceTimersByTime(900); });
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid changes into one upload', () => {
    const { result } = renderHook(() => useSettings(user({ solo_settings: { theme: 'light' } })));
    act(() => { result.current.updateSettings({ font_size: 'sm' }); result.current.updateSettings({ font_size: 'lg' }); });
    act(() => { vi.advanceTimersByTime(900); });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser.mock.calls[0][0].data.solo_settings.font_size).toBe('lg');
  });

  it('never calls the server when signed out', () => {
    const { result } = renderHook(() => useSettings(null));
    act(() => { result.current.updateSettings({ theme: 'dark' }); vi.advanceTimersByTime(900); });
    expect(updateUser).not.toHaveBeenCalled();
  });
});
