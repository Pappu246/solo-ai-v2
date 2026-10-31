import { describe, it, expect, afterEach } from 'vitest';
import { translate, setLanguage, getLanguage } from './i18n';
import { normalizeSettings } from './settings';

describe('i18n', () => {
  afterEach(() => setLanguage('en'));
  it('keeps English as the source text and falls back for unknown strings', () => {
    expect(translate('New chat')).toBe('New chat');
    setLanguage('hi');
    expect(getLanguage()).toBe('hi');
    expect(translate('New chat')).toBe('नई चैट');
    expect(translate('Some string with no translation')).toBe('Some string with no translation');
  });
  it('settings only accept supported languages', () => {
    expect(normalizeSettings({ language: 'hi' }).language).toBe('hi');
    expect(normalizeSettings({ language: 'fr' }).language).toBe('en');
    expect(normalizeSettings(null).language).toBe('en');
  });
});

describe('i18n settings coverage', () => {
  it('has a Hindi string for every label used on the settings screen', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/settings/SettingsPanel.tsx', 'utf8');
    const lit = [...src.matchAll(/(?:label|title|hint|description)="([^"{]+)"/g)].map(m => m[1])
      .filter(x => !/^(Accent color|Default model|Speaking rate)$/.test(x));
    setLanguage('hi');
    const missing = lit.filter(x => translate(x) === x && !/^[A-Z]{1,3}$/.test(x));
    setLanguage('en');
    expect(missing).toEqual([]);
  });
});

describe('i18n errors', () => {
  afterEach(() => setLanguage('en'));
  it('translates friendly errors and auth messages, leaving English untouched', async () => {
    const { toFriendlyError, friendlyAuthMessage } = await import('./errors');
    expect(toFriendlyError(Object.assign(new Error('x'), { code: 'rate_limited' })).title).toBe('Slow down');
    expect(friendlyAuthMessage(new Error('Invalid login credentials'))).toBe('Incorrect email or password.');
    setLanguage('hi');
    expect(toFriendlyError(Object.assign(new Error('x'), { code: 'rate_limited' })).title).toBe('थोड़ा धीरे');
    expect(friendlyAuthMessage(new Error('Invalid login credentials'))).toBe('ईमेल या पासवर्ड गलत है।');
  });
});
