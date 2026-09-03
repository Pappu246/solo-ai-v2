import { describe, it, expect } from 'vitest';
import { normalizeSettings, loadSettings, saveSettings, applyTheme, SETTINGS_STORAGE_KEY } from './settings';
import { DEFAULT_SETTINGS } from '../types';

describe('normalizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'neon', accent: 'plaid', font_size: 99 })).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps valid values and drops unknown keys', () => {
    const s = normalizeSettings({ theme: 'light', accent: 'blue', memory_enabled: true, tts_voice: 'alloy' });
    expect(s.theme).toBe('light');
    expect(s.accent).toBe('blue');
    expect('memory_enabled' in s).toBe(false);
    expect('tts_voice' in s).toBe(false);
  });
  it('migrates a legacy explicit default_model to preferred_model', () => {
    expect(normalizeSettings({ default_model: 'gpt-4o' }).preferred_model).toBe('gpt-4o');
    // The old hard-coded default meant "auto" in practice.
    expect(normalizeSettings({ default_model: 'gpt-oss-120b' }).preferred_model).toBeNull();
  });
  it('clamps tts_rate', () => {
    expect(normalizeSettings({ tts_rate: 9 }).tts_rate).toBe(1);
    expect(normalizeSettings({ tts_rate: 1.5 }).tts_rate).toBe(1.5);
  });
});

describe('load/save', () => {
  it('round-trips through localStorage', () => {
    saveSettings({ ...DEFAULT_SETTINGS, accent: 'rose' });
    expect(loadSettings().accent).toBe('rose');
  });
  it('survives corrupted storage', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{oops');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('applyTheme', () => {
  it('toggles the dark class and data attributes on <html>', () => {
    applyTheme({ ...DEFAULT_SETTINGS, theme: 'dark', accent: 'cyan', font_size: 'lg' });
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.accent).toBe('cyan');
    expect(root.dataset.fontSize).toBe('lg');
    applyTheme({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(root.classList.contains('dark')).toBe(false);
  });
});
