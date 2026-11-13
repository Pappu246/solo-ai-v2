/**
 * Rich copy: puts both formatted HTML and the original Markdown on the
 * clipboard. Word, Google Docs, Gmail, Notion etc. paste the formatted version
 * (tables, bold, lists, code); plain-text targets get the Markdown source.
 */

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'colspan', 'rowspan', 'start']);

const INLINE_STYLES: Record<string, string> = {
  table: 'border-collapse:collapse;margin:8px 0;',
  th: 'border:1px solid #bbb;padding:4px 8px;background:#f2f2f2;font-weight:600;text-align:left;',
  td: 'border:1px solid #bbb;padding:4px 8px;',
  pre: 'background:#f6f8fa;border:1px solid #ddd;padding:10px;font-family:Consolas,Menlo,monospace;font-size:90%;white-space:pre-wrap;',
  blockquote: 'border-left:3px solid #bbb;margin:8px 0;padding-left:12px;color:#555;',
  hr: 'border:0;border-top:1px solid #ccc;',
  img: 'max-width:100%;',
};
const INLINE_CODE_STYLE = 'font-family:Consolas,Menlo,monospace;background:#f2f2f2;padding:0 3px;';

/** Clean a rendered message into portable HTML: no app classes, no UI buttons, math as TeX. */
export function htmlForClipboard(root: HTMLElement): string {
  const doc = root.ownerDocument;
  const clone = root.cloneNode(true) as HTMLElement;

  const texOf = (el: Element) => el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null;
  clone.querySelectorAll('.katex-display').forEach(el => {
    const tex = texOf(el);
    el.replaceWith(doc.createTextNode(tex ? `$$${tex}$$` : el.textContent ?? ''));
  });
  clone.querySelectorAll('.katex').forEach(el => {
    const tex = texOf(el);
    el.replaceWith(doc.createTextNode(tex ? `$${tex}$` : el.textContent ?? ''));
  });

  // Code blocks: keep the <pre>, drop the header bar with the language label and copy button.
  clone.querySelectorAll('pre').forEach(pre => {
    const wrapper = pre.parentElement;
    if (wrapper && wrapper !== clone && wrapper.querySelector('button')) wrapper.replaceWith(pre);
  });
  clone.querySelectorAll('button, script, style, [aria-hidden="true"]:empty').forEach(el => el.remove());

  const all = [clone, ...Array.from(clone.querySelectorAll('*'))] as HTMLElement[];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
    }
    const tag = el.tagName.toLowerCase();
    const style = tag === 'code' && !el.closest('pre') ? INLINE_CODE_STYLE : INLINE_STYLES[tag];
    if (style) el.setAttribute('style', style);
  }
  return clone.innerHTML;
}

/** Copy text (and optional formatted HTML). Resolves false when the browser refuses. */
export async function copyRich(text: string, html: string | null): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([`<meta charset="utf-8">${html}`], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch { /* fall back to plain text below */ }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
