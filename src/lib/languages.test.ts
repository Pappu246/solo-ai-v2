import { describe, expect, it } from 'vitest';
import { detectLanguage, isVoiceLanguage, languageName } from './languages';
import { chunkForSpeech, plainForSpeech } from './tts';
import { normalizeSettings } from './settings';

describe('detectLanguage', () => {
  it('detects by script', () => {
    expect(detectLanguage('नमस्ते आप कैसे हैं', 'en-US')).toBe('hi-IN');
    expect(detectLanguage('வணக்கம்', 'en-US')).toBe('ta-IN');
    expect(detectLanguage('こんにちは', 'en-US')).toBe('ja-JP');
    expect(detectLanguage('Привет', 'en-US')).toBe('ru-RU');
  });
  it('keeps a same-script fallback (Marathi vs Hindi, Urdu vs Arabic)', () => {
    expect(detectLanguage('नमस्कार', 'mr-IN')).toBe('mr-IN');
    expect(detectLanguage('مرحبا', 'ur-PK')).toBe('ur-PK');
  });
  it('keeps the Latin-script language, else English', () => {
    expect(detectLanguage('bonjour', 'fr-FR')).toBe('fr-FR');
    expect(detectLanguage('hello', 'hi-IN')).toBe('en-US');
  });
});

describe('language helpers', () => {
  it('validates codes and names', () => {
    expect(isVoiceLanguage('auto')).toBe(true);
    expect(isVoiceLanguage('hi-IN')).toBe(true);
    expect(isVoiceLanguage('xx')).toBe(false);
    expect(languageName('hi-IN')).toBe('Hindi');
    expect(languageName('auto')).toBeNull();
  });
  it('normalizeSettings keeps only known voice languages', () => {
    expect(normalizeSettings({ voice_language: 'ta-IN' }).voice_language).toBe('ta-IN');
    expect(normalizeSettings({ voice_language: '<script>' }).voice_language).toBe('auto');
    expect(normalizeSettings({}).voice_language).toBe('auto');
  });
});

describe('speech text', () => {
  it('strips markdown so it sounds natural', () => {
    const out = plainForSpeech('# Title\n**Bold** and [link](https://x.com)\n- item\n```js\ncode()\n```\n| a | b |\n|---|---|');
    expect(out).not.toMatch(/[*#`|\]]|https|code\(\)/);
    expect(out).toContain('Bold and link');
  });
  it('chunks long text at sentence ends', () => {
    const chunks = chunkForSpeech('One sentence here. '.repeat(40));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every(c => c.length <= 270)).toBe(true);
  });
});
