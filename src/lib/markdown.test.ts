import { describe, it, expect } from 'vitest';
import { splitMarkdownSegments, normalizeMathDelimiters } from './markdown';

describe('splitMarkdownSegments', () => {
  it('returns a single md segment for plain markdown', () => {
    expect(splitMarkdownSegments('hello **world**')).toEqual([{ kind: 'md', text: 'hello **world**' }]);
  });

  it('extracts a block-level svg as its own segment', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
    const out = splitMarkdownSegments(`Here you go:\n\n${svg}\n\nAnd done.`);
    expect(out.map(s => s.kind)).toEqual(['md', 'svg', 'md']);
    expect(out[1].text).toBe(svg);
  });

  it('handles multiple svg blocks in sequence', () => {
    const a = '<svg><circle/></svg>';
    const b = '<svg><rect/></svg>';
    const out = splitMarkdownSegments(`${a}\n${b}`);
    expect(out.map(s => s.kind)).toEqual(['svg', 'svg']);
  });

  it('handles nested <svg> elements', () => {
    const src = '<svg><g><svg width="2" height="2"><circle/></svg></g></svg>';
    const out = splitMarkdownSegments(`text\n${src}\nafter`);
    expect(out[1]).toEqual({ kind: 'svg', text: src });
  });

  it('never touches svg markup inside fenced code blocks', () => {
    const fence = '```svg\n<svg><circle/></svg>\n```';
    const out = splitMarkdownSegments(`intro\n\n${fence}\n\noutro`);
    // Everything stays markdown (the fence renders via the code renderer);
    // no svg segment is ever carved out of a fenced block.
    expect(out.every(s => s.kind === 'md')).toBe(true);
    expect(out.map(s => s.text).join('\n')).toContain(fence);
  });

  it('never touches svg inside tilde fences either', () => {
    const out = splitMarkdownSegments('~~~\n<svg><circle/></svg>\n~~~');
    expect(out).toEqual([{ kind: 'md', text: '~~~\n<svg><circle/></svg>\n~~~' }]);
  });

  it('treats an unterminated fence (mid-stream) as code', () => {
    const out = splitMarkdownSegments('```svg\n<svg><circle/>');
    expect(out).toEqual([{ kind: 'md', text: '```svg\n<svg><circle/>' }]);
  });

  it('ignores inline svg mentions inside a sentence', () => {
    const text = 'you can use <svg> tags inline';
    expect(splitMarkdownSegments(text)).toEqual([{ kind: 'md', text }]);
  });

  it('ignores an svg that does not fill its line', () => {
    const text = '<svg><circle/></svg> trailing text';
    expect(splitMarkdownSegments(text)).toEqual([{ kind: 'md', text }]);
  });

  it('ignores a tag that merely starts with svg', () => {
    expect(splitMarkdownSegments('<svgish>nope</svgish>')).toEqual([{ kind: 'md', text: '<svgish>nope</svgish>' }]);
  });
});

describe('normalizeMathDelimiters', () => {
  it('rewrites \\( \\) to $ and \\[ \\] to flow-form $$', () => {
    expect(normalizeMathDelimiters('inline \\(x^2\\) math')).toBe('inline $x^2$ math');
    expect(normalizeMathDelimiters('block\n\\[E = mc^2\\]\nend')).toBe('block\n$$\nE = mc^2\n$$\nend');
  });

  it('turns single-line $$…$$ into flow form so it renders as display math', () => {
    expect(normalizeMathDelimiters('a $$x^2$$ b')).toBe('a $$\nx^2\n$$ b');
  });

  it('escapes currency-looking dollar pairs so they stay text', () => {
    expect(normalizeMathDelimiters('It costs $5 and $10 total.')).toBe('It costs \\$5 and \\$10 total.');
    expect(normalizeMathDelimiters('$1,000-$2,000 range')).toBe('\\$1,000-\\$2,000 range');
  });

  it('keeps real math dollar delimiters intact', () => {
    expect(normalizeMathDelimiters('the $E = mc^2$ formula')).toBe('the $E = mc^2$ formula');
    expect(normalizeMathDelimiters('the $x$ and $y$ axes')).toBe('the $x$ and $y$ axes');
  });

  it('leaves inline code spans untouched', () => {
    expect(normalizeMathDelimiters('run `\\(echo hi\\)` now')).toBe('run `\\(echo hi\\)` now');
    expect(normalizeMathDelimiters('`$5 and $10` literal')).toBe('`$5 and $10` literal');
  });
});
