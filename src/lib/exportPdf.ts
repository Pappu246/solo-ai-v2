import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Message } from '../types';
import { normalizeMathDelimiters } from './markdown';
import { safeHref } from './url';

type ExportMessage = Pick<Message, 'role' | 'content' | 'model_name' | 'model'>;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PRINT_CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1a1a1a; background: #fff; font: 11pt/1.6 system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Noto Sans Devanagari', 'Nirmala UI', Mangal, Arial, sans-serif; overflow-wrap: anywhere; }
h1 { font-size: 20pt; margin: 0 0 4pt; line-height: 1.25; }
.meta { color: #666; font-size: 9pt; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1px solid #ddd; }
.msg { margin: 0 0 12pt; }
.msg > h2 { font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; color: #666; margin: 0 0 3pt; }
.msg.user > .body { background: #f3f1ee; border-radius: 8px; padding: 6pt 10pt; white-space: pre-wrap; }
.body > :first-child { margin-top: 0; } .body > :last-child { margin-bottom: 0; }
h3, h4, h5, h6 { margin: 12pt 0 4pt; line-height: 1.3; }
.body h1 { font-size: 15pt; margin: 12pt 0 4pt; } .body h2 { font-size: 13pt; margin: 12pt 0 4pt; text-transform: none; letter-spacing: 0; color: inherit; }
p, ul, ol { margin: 0 0 7pt; } li { margin: 2pt 0; }
a { color: #0b57d0; text-decoration: underline; }
blockquote { margin: 7pt 0; padding: 2pt 0 2pt 10pt; border-left: 3px solid #c9c9c9; color: #444; }
code { font-family: Consolas, Menlo, 'Courier New', monospace; font-size: 90%; background: #f2f2f2; padding: 0 3px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #ddd; border-radius: 6px; padding: 8pt 10pt; margin: 7pt 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 9.5pt; line-height: 1.45; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
th, td { border: 1px solid #bbb; padding: 4pt 7pt; text-align: left; vertical-align: top; }
th { background: #f0f0f0; font-weight: 600; }
tr, img, pre, blockquote { break-inside: avoid; } thead { display: table-header-group; } h1, h2, h3, h4 { break-after: avoid; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #ccc; margin: 10pt 0; }
.katex-display { margin: 8pt 0; overflow: hidden; }
`;

async function renderMarkdownToHtml(markdown: string): Promise<string> {
  // Only the server renderer and KaTeX are loaded on demand; the rest is already in the app bundle.
  const [{ renderToStaticMarkup }, { default: rehypeKatex }] = await Promise.all([import('react-dom/server'), import('rehype-katex')]);
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [[rehypeKatex, { strict: false, errorColor: '#c62828' }]],
      components: {
        a: ({ href, children }) => createElement('a', { href: safeHref(href) }, children),
        img: ({ src, alt }) => {
          const safe = safeHref(src);
          return safe ? createElement('img', { src: safe, alt: alt || '' }) : null;
        },
      },
    }, normalizeMathDelimiters(markdown)),
  );
}

/** A self-contained, print-ready HTML document for a whole conversation. */
export async function buildPrintableHtml(
  title: string | null,
  messages: ExportMessage[],
  opts: { katexCssUrl?: string; lang?: string; now?: Date } = {},
): Promise<string> {
  const heading = (title || 'Chat').replace(/\s+/g, ' ').trim();
  const sections: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = m.content.trim();
    if (!text) continue;
    if (m.role === 'user') {
      sections.push(`<section class="msg user"><h2>You</h2><div class="body">${escapeHtml(text)}</div></section>`);
    } else {
      const who = `Solo AI${m.model_name || m.model ? ` · ${escapeHtml(String(m.model_name || m.model))}` : ''}`;
      sections.push(`<section class="msg assistant"><h2>${who}</h2><div class="body">${await renderMarkdownToHtml(text)}</div></section>`);
    }
  }
  const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const css = opts.katexCssUrl ? `<link rel="stylesheet" href="${escapeHtml(opts.katexCssUrl)}">` : '';
  return `<!doctype html><html lang="${escapeHtml(opts.lang ?? 'en')}"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>${css}<style>${PRINT_CSS}</style></head><body><h1>${escapeHtml(heading)}</h1><p class="meta">Solo AI · ${date}</p>${sections.join('')}</body></html>`;
}

/**
 * Open the browser's print dialog for the conversation (choose "Save as PDF").
 * Uses a hidden same-origin iframe, so the text stays selectable and Hindi,
 * tables and math print exactly as rendered. Nothing is uploaded anywhere.
 */
export async function printConversation(title: string | null, messages: ExportMessage[], lang = 'en'): Promise<void> {
  let katexCssUrl: string | undefined;
  try {
    katexCssUrl = new URL((await import('katex/dist/katex.min.css?url')).default, window.location.href).href;
  } catch { /* math will print without its stylesheet */ }
  const html = await buildPrintableHtml(title, messages, { katexCssUrl, lang });

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  const previousTitle = document.title;
  const cleanup = () => { document.title = previousTitle; iframe.remove(); };

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); reject(new Error('print frame unavailable')); return; }
      // Chrome names the PDF after the page title; restore it afterwards.
      document.title = (title || 'Chat').replace(/\s+/g, ' ').trim();
      win.addEventListener('afterprint', cleanup, { once: true });
      window.setTimeout(cleanup, 120_000);
      Promise.resolve(win.document.fonts?.ready).catch(() => {}).then(() => {
        try { win.focus(); win.print(); resolve(); } catch (err) { cleanup(); reject(err); }
      });
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}
