import { describe, it, expect } from 'vitest';
import { conversationToMarkdown, exportFilename } from './exportChat';

describe('exportChat', () => {
  it('renders turns with the model name and skips system messages', () => {
    const md = conversationToMarkdown('My  chat', [
      { role: 'system', content: 'hidden' },
      { role: 'user', content: ' hello ' },
      { role: 'assistant', content: 'hi there', model_name: 'GPT OSS 120B' },
    ] as never);
    expect(md).toBe('# My chat\n\n## You\n\nhello\n\n## Solo AI (GPT OSS 120B)\n\nhi there\n');
  });
  it('builds a safe dated filename, including non-latin titles', () => {
    const d = new Date('2026-10-25T10:00:00Z');
    expect(exportFilename('Hello, World!/..', d)).toBe('hello-world-2026-10-25.md');
    expect(exportFilename('नमस्ते दुनिया', d)).toContain('नमस्ते');
    expect(exportFilename(null, d)).toBe('chat-2026-10-25.md');
  });
});
