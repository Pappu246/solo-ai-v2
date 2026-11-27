/**
 * Offline tests for the study client: URL parsing, function URL derivation and
 * the localStorage cache (jsdom localStorage, no network).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  forgetStudyResult,
  loadStudyCache,
  parseVideoId,
  rememberStudyResult,
  watchUrl,
  type StudyResult,
} from './study';

describe('parseVideoId', () => {
  it('accepts watch URLs with extra params', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('accepts shorts, youtu.be, embed and bare ids', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects non-YouTube and malformed input', () => {
    expect(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoId('hello world')).toBeNull();
    expect(parseVideoId('')).toBeNull();
  });
});

describe('watchUrl', () => {
  it('builds a timestamped watch link', () => {
    expect(watchUrl('dQw4w9WgXcQ', 95)).toBe('https://youtu.be/dQw4w9WgXcQ?t=95');
  });

  it('omits the timestamp when unknown', () => {
    expect(watchUrl('dQw4w9WgXcQ', null)).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(watchUrl('dQw4w9WgXcQ', -1)).toBe('https://youtu.be/dQw4w9WgXcQ');
  });
});

describe('study cache', () => {
  const pack: StudyResult = {
    videoId: 'dQw4w9WgXcQ',
    pack: { title: 'T', summary: 'S', notes: [], quiz: [], flashcards: [] },
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(loadStudyCache()).toEqual([]);
  });

  it('stores, retrieves and de-duplicates results', () => {
    rememberStudyResult(pack);
    expect(loadStudyCache()).toHaveLength(1);

    const second = { ...pack, videoId: 'abc12345678' };
    const entries = rememberStudyResult(second);
    expect(entries).toHaveLength(2);
    expect(loadStudyCache().map((e) => e.videoId)).toEqual(['abc12345678', 'dQw4w9WgXcQ']);

    // Re-generating the same video replaces its entry instead of duplicating.
    const again = rememberStudyResult(pack);
    expect(again).toHaveLength(2);
    expect(loadStudyCache().filter((e) => e.videoId === 'dQw4w9WgXcQ')).toHaveLength(1);
  });

  it('removes a result by video id', () => {
    rememberStudyResult(pack);
    const next = forgetStudyResult('dQw4w9WgXcQ');
    expect(next).toEqual([]);
    expect(loadStudyCache()).toEqual([]);
  });

  it('survives corrupt cache data', () => {
    localStorage.setItem('solo-ai-study-packs', 'not json');
    expect(loadStudyCache()).toEqual([]);
    localStorage.setItem('solo-ai-study-packs', JSON.stringify([{ garbage: true }, null]));
    expect(loadStudyCache()).toEqual([]);
  });
});
