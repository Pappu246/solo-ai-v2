import { useState, useCallback } from 'react';
import type { UserSettings } from '../types';
import { loadSettings, saveSettings, applyTheme } from '../lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const s = loadSettings();
    applyTheme(s);
    return s;
  });

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      applyTheme(next);
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
