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
