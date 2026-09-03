import { useState, useCallback, useEffect } from 'react';
import type { UserSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { loadSettings, saveSettings, applyTheme } from '../lib/settings';

export function useSettings() {
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

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      applyTheme(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    saveSettings(next);
    applyTheme(next);
    setSettings(next);
  }, []);

  return { settings, updateSettings, resetSettings };
}
