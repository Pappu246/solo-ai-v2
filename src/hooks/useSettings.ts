import { useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { loadSettings, saveSettings, applyTheme, normalizeSettings } from '../lib/settings';
import { supabase } from '../lib/supabase';

const META_KEY = 'solo_settings';
const PUSH_DELAY_MS = 800;

/**
 * Settings live in localStorage (instant, works offline) and are mirrored to the
 * signed-in user's auth metadata so every device shows the same theme, model and
 * preferences. No table or migration needed. The first sign-in on a device pulls
 * the saved copy; if none exists yet, this device's settings become the saved copy.
 */
export function useSettings(user?: User | null) {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const s = loadSettings();
    applyTheme(s);
    return s;
  });

  // Follow OS theme changes while in "system" mode.
  useEffect(() => {
    if (settings.theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(settings);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings]);

  const userId = user?.id ?? null;
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulledFor = useRef<string | null>(null);

  const push = useCallback((next: UserSettings) => {
    if (!userId) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      Promise.resolve(supabase.auth.updateUser({ data: { [META_KEY]: next } })).catch(() => { /* offline: local copy still applies */ });
    }, PUSH_DELAY_MS);
  }, [userId]);

  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current); }, []);

  useEffect(() => {
    if (!user || pulledFor.current === user.id) return;
    pulledFor.current = user.id;
    const remote = user.user_metadata?.[META_KEY];
    if (remote && typeof remote === 'object') {
      const next = normalizeSettings(remote);
      saveSettings(next);
      applyTheme(next);
      setSettings(next);
    } else {
      push(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      applyTheme(next);
      push(next);
      return next;
    });
  }, [push]);

  const resetSettings = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    saveSettings(next);
    applyTheme(next);
    setSettings(next);
    push(next);
  }, [push]);

  return { settings, updateSettings, resetSettings };
}
