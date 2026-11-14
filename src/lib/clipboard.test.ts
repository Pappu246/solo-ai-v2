import { describe, it, expect, vi, afterEach } from 'vitest';
import { htmlForClipboard, copyRich } from './clipboard';

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('htmlForClipboard', () => {
  it('keeps structure, inlines table/code styling and drops app classes', () => {
    const out = htmlForClipboard(el('<h2 class="x">Title</h2><table class="t"><thead><tr><th class="a">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>Use <code class="c">npm</code> <strong>now</strong></p>'));
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toMatch(/<table style="[^"]*border-collapse:collapse;width:100%/);
    expect(out).toMatch(/<th style="[^"]*border:1px solid/);
    expect(out).toMatch(/<td style="[^"]*border:1px solid/);
    expect(out).toContain('<strong>now</strong>');
    expect(out).toMatch(/<table[^>]*width="100%"/);
    expect(out).not.toMatch(/class=/);
  });

  it('replaces the code-block chrome with just the <pre>', () => {
    const out = htmlForClipboard(el('<div class="relative"><span aria-hidden="true"></span><div><span>ts</span><button>Copy</button></div><pre class="p"><code class="hljs">const a = 1;</code></pre></div>'));
    expect(out).toMatch(/^<pre style="[^"]*white-space:pre-wrap/);
    expect(out).toContain('const a = 1;');
    expect(out).not.toContain('Copy');
    expect(out).not.toContain('>ts<');
  });

  it('turns rendered math back into TeX', () => {
    const out = htmlForClipboard(el('<p>Energy <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html">E=mc2</span></span></p>'));
    expect(out).toContain('$E=mc^2$');
    expect(out).not.toContain('katex');
  });

  it('keeps links, strips event handlers and scripts', () => {
    const out = htmlForClipboard(el('<a href="https://x.dev" onclick="evil()" class="k">x</a><script>alert(1)</script>'));
    expect(out).toContain('href="https://x.dev"');
    expect(out).not.toMatch(/onclick|script|alert/);
  });
});

describe('copyRich', () => {
  const original = { cb: navigator.clipboard, item: (globalThis as { ClipboardItem?: unknown }).ClipboardItem };
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: original.cb, configurable: true });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = original.item;
  });

  it('writes HTML and plain text together', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
    class FakeItem { constructor(public data: Record<string, Blob>) {} }
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeItem;
    expect(await copyRich('**md**', '<strong>md</strong>')).toBe(true);
    const item = write.mock.calls[0][0][0] as FakeItem;
    expect(Object.keys(item.data).sort()).toEqual(['text/html', 'text/plain']);
    expect(await item.data['text/plain'].text()).toBe('**md**');
    expect(await item.data['text/html'].text()).toContain('<strong>md</strong>');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to plain text when rich copy is unsupported or rejected', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn().mockRejectedValue(new Error('denied')), writeText }, configurable: true });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class { constructor() {} };
    expect(await copyRich('plain', '<b>plain</b>')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('plain');
  });

  it('reports failure when nothing can be written', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    expect(await copyRich('x', null)).toBe(false);
  });
});
