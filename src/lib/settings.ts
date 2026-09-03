import type { UserSettings, Theme, AccentColor, FontSize } from '../types';
import { DEFAULT_SETTINGS, ACCENT_OPTIONS } from '../types';

export const SETTINGS_STORAGE_KEY = 'solo-ai-settings';

const THEMES: Theme[] = ['dark', 'light', 'system'];
const FONT_SIZES: FontSize[] = ['sm', 'base', 'lg'];
const ACCENTS = ACCENT_OPTIONS.map(a => a.value);

/**
 * Coerce an arbitrary (possibly legacy or corrupted) object into a valid
 * UserSettings. Unknown keys are dropped; invalid values fall back to defaults.
 */
export function normalizeSettings(raw: unknown): UserSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

  // Legacy key: `default_model` → `preferred_model` (only when it was explicitly set).
  const legacyModel = typeof r.default_model === 'string' && r.default_model && r.default_model !== 'gpt-oss-120b'
    ? r.default_model
    : null;

  return {
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : DEFAULT_SETTINGS.theme,
    accent: ACCENTS.includes(r.accent as AccentColor) ? (r.accent as AccentColor) : DEFAULT_SETTINGS.accent,
    font_size: FONT_SIZES.includes(r.font_size as FontSize) ? (r.font_size as FontSize) : DEFAULT_SETTINGS.font_size,
    show_model_badges: bool(r.show_model_badges, DEFAULT_SETTINGS.show_model_badges),
    send_on_enter: bool(r.send_on_enter, DEFAULT_SETTINGS.send_on_enter),
    auto_title: bool(r.auto_title, DEFAULT_SETTINGS.auto_title),
    preferred_model: typeof r.preferred_model === 'string' && r.preferred_model ? r.preferred_model : legacyModel,
    tts_enabled: bool(r.tts_enabled, DEFAULT_SETTINGS.tts_enabled),
    tts_rate: typeof r.tts_rate === 'number' && r.tts_rate >= 0.5 && r.tts_rate <= 2 ? r.tts_rate : DEFAULT_SETTINGS.tts_rate,
  };
}

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable (private mode); settings still apply in-memory */
  }
}

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply theme/accent/font-size to the document root. Idempotent. */
export function applyTheme(settings: UserSettings) {
  const root = document.documentElement;
  const effective = resolveTheme(settings.theme);
  root.classList.toggle('dark', effective === 'dark');
  root.setAttribute('data-theme', effective);
  root.setAttribute('data-accent', settings.accent);
  root.setAttribute('data-font-size', settings.font_size);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'dark' ? '#0c0c0d' : '#fafafa');
}
