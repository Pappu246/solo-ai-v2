import { describe, it, expect } from 'vitest';
import { buildPrintableHtml, escapeHtml } from './exportPdf';

const msgs = (assistant: string) => [
  { role: 'user' as const, content: 'आज की खबर <b>bold</b> & more', model_name: null, model: null },
  { role: 'assistant' as const, content: assistant, model_name: 'GPT OSS 120B', model: 'x' },
];

describe('buildPrintableHtml', () => {
  it('renders headings, tables, lists and code as real HTML', async () => {
    const html = await buildPrintableHtml('Today news', msgs('## Highlights\n\n| Topic | Source |\n|---|---|\n| Cricket | [1] |\n\n- one\n- two\n\n```ts\nconst a = 1 < 2;\n```'));
    expect(html).toContain('<title>Today news</title>');
    expect(html).toMatch(/<h2[^>]*>Highlights<\/h2>/);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Topic</th>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2;');
    expect(html).toContain('Solo AI · GPT OSS 120B');
    expect(html).toContain('@page');
  });

  it('keeps Hindi text intact and escapes the user message', async () => {
    const html = await buildPrintableHtml('चैट', msgs('यह **जवाब** है'));
    expect(html).toContain('आज की खबर &lt;b&gt;bold&lt;/b&gt; &amp; more');
    expect(html).toContain('<strong>जवाब</strong>');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('renders math with KaTeX', async () => {
    const html = await buildPrintableHtml('m', msgs('Energy: $E=mc^2$'));
    expect(html).toContain('class="katex"');
  });

  it('never emits model-written tags, handlers or javascript: URLs', async () => {
    const raw = await buildPrintableHtml('x', msgs('<script>alert(1)</script> <img src=x onerror=alert(3)>'));
    expect(raw).not.toMatch(/<script/i);
    expect(raw).not.toMatch(/<img/i);
    const links = await buildPrintableHtml('x', msgs('[click](javascript:alert(1))\n\n![i](javascript:alert(2))\n\n[ok](https://example.com)'));
    expect(links).not.toMatch(/href="javascript:/i);
    expect(links).not.toMatch(/src="javascript:/i);
    expect(links).toContain('href="https://example.com"');
  });

  it('escapes the title and skips empty or system messages', async () => {
    const html = await buildPrintableHtml('</title><script>x</script>', [
      { role: 'system' as never, content: 'secret', model_name: null, model: null },
      { role: 'assistant', content: '   ', model_name: null, model: null },
    ]);
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('class="msg');
  });

  it('escapeHtml covers quotes', () => {
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });
});
