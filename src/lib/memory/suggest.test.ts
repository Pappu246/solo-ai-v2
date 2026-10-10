import { describe, it, expect } from 'vitest';
import { detectMemorySuggestion, SUGGEST_MIN_CHARS, SUGGEST_MAX_CHARS } from './suggest';

describe('detectMemorySuggestion', () => {
  it('detects lasting preferences', () => {
    const s = detectMemorySuggestion('I prefer concise answers with code first, no preamble');
    expect(s).not.toBeNull();
    expect(s!.type).toBe('preference');
    expect(s!.content).toContain('concise answers');
    expect(s!.reason.length).toBeGreaterThan(10);
  });

  it('detects standing instructions', () => {
    expect(detectMemorySuggestion('Never use bullet points, I think in paragraphs')!.type).toBe('instruction');
    expect(detectMemorySuggestion('Always reply to me in German from now on')!.type).toBe('instruction');
    expect(detectMemorySuggestion('Remember to call me by my last name')!.type).toBe('instruction');
  });

  it('detects personal facts', () => {
    expect(detectMemorySuggestion('My name is Mara and I work as a surgeon')!.type).toBe('fact');
    expect(detectMemorySuggestion('I live in Lisbon and I work at a fintech')!.type).toBe('fact');
    expect(detectMemorySuggestion('We use Postgres for everything at our team')!.type).toBe('fact');
  });

  it('stays quiet for questions', () => {
    expect(detectMemorySuggestion('How do I prefer my coffee usually?')).toBeNull();
    expect(detectMemorySuggestion('What is the capital of France?')).toBeNull();
  });

  it('stays quiet for one-off requests', () => {
    expect(detectMemorySuggestion('Write me a haiku about autumn leaves')).toBeNull();
    expect(detectMemorySuggestion('Summarize this article about quantum computing in one paragraph')).toBeNull();
    expect(detectMemorySuggestion('Fix the failing test in my repository please')).toBeNull();
  });

  it('stays quiet for code and pasted data', () => {
    expect(detectMemorySuggestion('const x = useMemo(() => compute(a, b), [a, b]);')).toBeNull();
    expect(detectMemorySuggestion('function always(items) {\n  return items.filter(Boolean);\n}')).toBeNull();
    expect(detectMemorySuggestion('SELECT id, name FROM users WHERE always_active = true;')).toBeNull();
  });

  it('stays quiet for short or long messages', () => {
    expect(detectMemorySuggestion('ok thanks')).toBeNull();
    expect(detectMemorySuggestion('hi')).toBeNull();
    expect(detectMemorySuggestion('I like everything about this '.padEnd(SUGGEST_MAX_CHARS + 1, 'x'))).toBeNull();
    expect(SUGGEST_MIN_CHARS).toBeGreaterThan(0);
    expect(SUGGEST_MAX_CHARS).toBeGreaterThan(SUGGEST_MIN_CHARS);
  });

  it('stays quiet for chatty multi-sentence messages', () => {
    expect(detectMemorySuggestion('I like this. But can you change it? Maybe tomorrow we decide.')).toBeNull();
    expect(detectMemorySuggestion('I prefer tea. I also like coffee. Sometimes I drink both.')).toBeNull();
  });

  it('stays quiet for ordinary topic messages', () => {
    expect(detectMemorySuggestion('Explain the tradeoffs between REST and GraphQL APIs')).toBeNull();
    expect(detectMemorySuggestion('The quarterly report showed revenue growth of twelve percent')).toBeNull();
  });

  it('prefers preference over instruction when both match', () => {
    const s = detectMemorySuggestion('I always prefer short answers, never pad them');
    expect(s!.type).toBe('preference');
  });

  it('handles empty and non-string-like input safely', () => {
    expect(detectMemorySuggestion('')).toBeNull();
    expect(detectMemorySuggestion('   \n\t ')).toBeNull();
  });

  it('preserves the original wording in the suggested content', () => {
    const text = 'Never greet me with hello, I find it cold and formal';
    expect(detectMemorySuggestion(text)!.content).toBe(text);
  });
});
