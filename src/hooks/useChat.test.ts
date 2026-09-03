import { describe, it, expect } from 'vitest';
import { deriveTitle } from './useChat';

describe('deriveTitle', () => {
  it('collapses whitespace and truncates long input', () => {
    expect(deriveTitle('  hello\n\nworld ')).toBe('hello world');
    const long = 'x'.repeat(100);
    expect(deriveTitle(long).length).toBe(49);
    expect(deriveTitle(long).endsWith('…')).toBe(true);
  });
  it('falls back for empty content', () => {
    expect(deriveTitle('   ')).toBe('New chat');
  });
});
