import { describe, it, expect } from 'vitest';
import {
  buildDocumentHtml,
  buildDocumentCss,
  documentFilename,
  replaceMermaidBlocks,
  PAGE_WIDTH_PX,
  type PdfTemplate,
} from './pdfDocument';

const template: PdfTemplate = {
  page: 'a4',
  margin: 16,
  font: 'sans',
  accent: '#4f46e5',
  title: 'My Notes',
  subtitle: 'Quarterly review',
  footer: 'Solo AI',
};

describe('buildDocumentHtml', () => {
  it('builds a self-contained document with title, subtitle and footer', async () => {
    const html = await buildDocumentHtml('Hello **world**', template);
    expect(html).toContain('<title>My Notes</title>');
    expect(html).toContain('<h1 class="doc-title">My Notes</h1>');
    expect(html).toContain('Quarterly review');
    expect(html).toContain('Solo AI');
    expect(html).toContain('<!doctype html>');
  });

  it('applies page size, margin and accent to the CSS', async () => {
    const html = await buildDocumentHtml('text', { ...template, page: 'letter', margin: 24, accent: '#dc2626' });
    expect(html).toContain('size: 8.5in 11in');
    expect(html).toContain('margin: 24mm');
    expect(html).toContain('#dc2626');
  });

  it('renders markdown body as real HTML', async () => {
    const html = await buildDocumentHtml('## Head\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |', template);
    expect(html).toMatch(/<h2[^>]*>Head<\/h2>/);
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<th>A</th>');
  });

  it('escapes raw HTML in the title', async () => {
    const html = await buildDocumentHtml('body', { ...template, title: 'A <b> & "x"' });
    expect(html).toContain('A &lt;b&gt; &amp; &quot;x&quot;');
    expect(html).not.toMatch(/<b> & /);
  });

  it('still produces a valid doc when the body is empty', async () => {
    const html = await buildDocumentHtml('', template);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('doc-title');
  });
});

describe('documentFilename', () => {
  it('turns a title into a safe file name', () => {
    expect(documentFilename('My Notes')).toBe('My-Notes.pdf');
    expect(documentFilename('  Hello   World  ')).toBe('Hello-World.pdf');
    expect(documentFilename('')).toBe('document.pdf');
  });

  it('strips characters that are unsafe in file names', () => {
    expect(documentFilename('a/b:c*?')).toBe('abc.pdf');
  });
});

describe('buildDocumentCss', () => {
  it('bakes page size, margin and accent into the stylesheet', () => {
    const css = buildDocumentCss({ ...template, page: 'letter', margin: 20, accent: '#123456' });
    expect(css).toContain('size: 8.5in 11in');
    expect(css).toContain('margin: 20mm');
    expect(css).toContain('#123456');
  });

  it('uses the A4 size for a4 pages', () => {
    expect(buildDocumentCss(template)).toContain('size: A4');
  });
});

describe('PAGE_WIDTH_PX', () => {
  it('maps each page to a positive screen width', () => {
    expect(PAGE_WIDTH_PX.a4).toBeGreaterThan(0);
    expect(PAGE_WIDTH_PX.letter).toBeGreaterThan(0);
  });
});

describe('replaceMermaidBlocks', () => {
  it('returns text unchanged when there are no diagram blocks', async () => {
    const md = 'Just some **markdown** text.';
    expect(await replaceMermaidBlocks(md)).toBe(md);
  });

  it('never throws on a diagram block, even if rendering is unavailable', async () => {
    const md = 'Before\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nAfter';
    const out = await replaceMermaidBlocks(md);
    expect(typeof out).toBe('string');
    // Either the diagram rendered to an image, or the code block was left intact.
    expect(out.includes('data:image/svg+xml') || out.includes('```mermaid')).toBe(true);
  });
});
