import { renderMarkdownToHtml, escapeHtml } from './exportPdf';

export type PdfPage = 'a4' | 'letter';
export type PdfFont = 'sans' | 'serif' | 'mono';

export interface PdfTemplate {
  page: PdfPage;
  /** Page margin in millimetres. */
  margin: number;
  font: PdfFont;
  /** Accent colour used for the title rule, headings and links. */
  accent: string;
  title?: string;
  subtitle?: string;
  footer?: string;
}

export const PDF_FONTS: { id: PdfFont; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
];

export const PDF_PAGES: { id: PdfPage; label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'Letter' },
];

/** Screen width (px at 96dpi) of each page, used to size the render canvas. */
export const PAGE_WIDTH_PX: Record<PdfPage, number> = { a4: 794, letter: 816 };

const FONT_STACK: Record<PdfFont, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Noto Sans Devanagari', 'Nirmala UI', Mangal, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Noto Serif', 'Noto Serif Devanagari', serif",
  mono: "Consolas, Menlo, 'SF Mono', 'Courier New', monospace",
};

export function buildDocumentCss(t: PdfTemplate): string {
  const size = t.page === 'letter' ? '8.5in 11in' : 'A4';
  return `
@page { size: ${size}; margin: ${t.margin}mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: #1a1a1a;
  background: #fff;
  font: 11pt/1.65 ${FONT_STACK[t.font]};
  overflow-wrap: anywhere;
}
.doc-title { font-size: 22pt; line-height: 1.2; margin: 0 0 4pt; color: ${t.accent}; }
.doc-subtitle { color: #666; font-size: 10.5pt; margin: 0 0 6pt; }
.doc-rule { height: 2px; background: ${t.accent}; opacity: .85; margin: 0 0 16pt; }
h1, h2, h3, h4, h5, h6 { color: ${t.accent}; line-height: 1.25; break-after: avoid; }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
h1 { font-size: 16pt; margin: 16pt 0 6pt; }
h2 { font-size: 14pt; margin: 14pt 0 5pt; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; }
h4, h5, h6 { font-size: 11pt; margin: 10pt 0 3pt; }
p, ul, ol { margin: 0 0 7pt; }
li { margin: 2pt 0; }
a { color: ${t.accent}; text-decoration: underline; }
blockquote { margin: 8pt 0; padding: 2pt 0 2pt 10pt; border-left: 3px solid ${t.accent}; color: #444; }
code { font-family: ${FONT_STACK.mono}; font-size: 90%; background: #f2f2f2; padding: 0 3px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #ddd; border-radius: 6px; padding: 8pt 10pt; margin: 8pt 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 9.5pt; line-height: 1.45; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
th, td { border: 1px solid #bbb; padding: 4pt 7pt; text-align: left; vertical-align: top; }
th { background: #f0f0f0; font-weight: 600; }
thead { display: table-header-group; }
tr, img, pre, blockquote { break-inside: avoid; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #ccc; margin: 12pt 0; }
.katex-display { margin: 8pt 0; overflow: hidden; }
.doc-footer { color: #888; font-size: 8.5pt; margin-top: 18pt; padding-top: 6pt; border-top: 1px solid #eee; }
`;
}

/** Title block + rendered body + footer as inner HTML (used by both preview and PDF). */
export async function buildDocumentBodyHtml(
  markdown: string,
  template: PdfTemplate,
  lang = 'en',
): Promise<string> {
  const title = (template.title || 'Document').replace(/\s+/g, ' ').trim();
  const body = (markdown || '').trim();
  const header =
    `<h1 class="doc-title">${escapeHtml(title)}</h1>` +
    (template.subtitle ? `<p class="doc-subtitle">${escapeHtml(template.subtitle)}</p>` : '') +
    `<div class="doc-rule"></div>`;
  const content = body ? `<div class="body">${await renderMarkdownToHtml(body)}</div>` : '';
  const footer = template.footer
    ? `<div class="doc-footer">${escapeHtml(template.footer)}</div>`
    : '';
  return `<div class="doc" lang="${escapeHtml(lang)}">${header}${content}${footer}</div>`;
}

/** A self-contained, print-ready HTML document from markdown text and a template. */
export async function buildDocumentHtml(
  markdown: string,
  template: PdfTemplate,
  lang = 'en',
  katexCssUrl?: string,
): Promise<string> {
  const title = (template.title || 'Document').replace(/\s+/g, ' ').trim();
  const css = katexCssUrl ? `<link rel="stylesheet" href="${escapeHtml(katexCssUrl)}">` : '';
  const body = await buildDocumentBodyHtml(markdown, template, lang);
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${css}<style>${buildDocumentCss(template)}</style></head><body>${body}</body></html>`;
}

/** Turn a title into a safe file name. */
export function documentFilename(title: string, ext = 'pdf'): string {
  return `${(title || 'document').replace(/\s+/g, '-').replace(/[^\w.-]+/g, '').replace(/^-+|-+$/g, '') || 'document'}.${ext}`;
}

// ── Mermaid diagrams ──────────────────────────────────────────────────────────
const MERMAID_RE = /```mermaid\s*\n([\s\S]*?)```/g;

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then(m => m.default)
      .then(mermaid => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        return mermaid;
      })
      .catch(err => { mermaidPromise = null; throw err; });
  }
  return mermaidPromise;
}

/** Render a single Mermaid source string to an SVG. */
export async function renderMermaidToSvg(code: string): Promise<string> {
  const mermaid = await loadMermaid();
  const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
  const { svg } = await mermaid.render(id, code.trim());
  return svg;
}

/**
 * Replace every ```mermaid block in the markdown with a data-URL image so it
 * renders in both the preview and the exported PDF. Blocks that fail to render
 * are left untouched (shown as code) rather than breaking the whole document.
 */
export async function replaceMermaidBlocks(markdown: string): Promise<string> {
  const matches = [...markdown.matchAll(MERMAID_RE)];
  if (matches.length === 0) return markdown;
  const rendered = await Promise.all(
    matches.map(async m => {
      try {
        const svg = await renderMermaidToSvg(m[1]);
        const data = btoa(unescape(encodeURIComponent(svg)));
        return `![diagram](data:image/svg+xml;base64,${data})`;
      } catch {
        return null;
      }
    }),
  );
  let out = '';
  let last = 0;
  matches.forEach((m, i) => {
    out += markdown.slice(last, m.index);
    out += rendered[i] ?? m[0];
    last = m.index + m[0].length;
  });
  out += markdown.slice(last);
  return out;
}

// ── Real PDF file generation ──────────────────────────────────────────────────

/**
 * Render the document to a real, downloadable PDF file using html2canvas + jsPDF.
 * Works fully client-side (no server, no API key) and handles text, images and
 * Mermaid diagrams. Falls back to the browser print dialog if the PDF stack
 * cannot initialise.
 */
export async function downloadPdf(
  markdown: string,
  template: PdfTemplate,
  filename: string,
  lang = 'en',
): Promise<void> {
  const withDiagrams = await replaceMermaidBlocks(markdown);
  const body = await buildDocumentBodyHtml(withDiagrams, template, lang);
  const css = buildDocumentCss(template);
  const pageWidthPx = PAGE_WIDTH_PX[template.page];

  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${pageWidthPx}px;` +
    `padding:${template.margin}mm;background:#fff;color:#1a1a1a;`;
  container.innerHTML = `<style>${css}</style>${body}`;
  document.body.appendChild(container);

  try {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    // Wait for any images (uploaded or diagram) to finish loading.
    await Promise.all(
      [...container.querySelectorAll('img')].map(img =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>(res => { img.addEventListener('load', () => res(), { once: true }); img.addEventListener('error', () => res(), { once: true }); }),
      ),
    );

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: template.page });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;
    while (heightLeft > 0) {
      pdf.addPage();
      position = heightLeft - imgHeight;
      pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }
    pdf.save(filename);
  } finally {
    container.remove();
  }
}

/**
 * Open the browser's print dialog for the document (choose "Save as PDF").
 * Uses a hidden same-origin iframe so text stays selectable and Hindi, tables
 * and math print exactly as rendered.
 */
export async function printDocument(
  markdown: string,
  template: PdfTemplate,
  lang = 'en',
): Promise<void> {
  let katexCssUrl: string | undefined;
  try {
    katexCssUrl = new URL((await import('katex/dist/katex.min.css?url')).default, window.location.href).href;
  } catch { /* math prints without its stylesheet */ }
  const withDiagrams = await replaceMermaidBlocks(markdown);
  const html = await buildDocumentHtml(withDiagrams, template, lang, katexCssUrl);
  const title = (template.title || 'Document').replace(/\s+/g, ' ').trim();

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
      document.title = title;
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
