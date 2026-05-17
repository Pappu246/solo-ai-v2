import type { UserSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const KEY = 'solo-ai-settings';

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: UserSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function applyTheme(settings: UserSettings) {
  const root = document.documentElement;
  const effectiveTheme = settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme;
  root.setAttribute('data-theme', effectiveTheme);
  root.setAttribute('data-accent', settings.accent);
  if (effectiveTheme === 'light') {
    document.body.style.background = '#f8f8f8';
    document.body.style.color = '#18181b';
  } else {
    document.body.style.background = '#080808';
    document.body.style.color = '#e4e4e7';
  }
}
