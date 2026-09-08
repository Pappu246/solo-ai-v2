/**
 * Helpers that prepare assistant markdown for rendering.
 *
 * Two jobs, both about *safety boundaries*:
 *
 *  1. `splitMarkdownSegments` — pulls block-level `<svg>…</svg>` regions out
 *     of the markdown so they can be rendered as sanitized graphics, while
 *     fenced code regions are never touched (a fenced ```svg block is handled
 *     by the code renderer). Everything that is not an SVG block keeps going
 *     through react-markdown with `skipHtml`, so no other raw HTML is ever
 *     rendered.
 *
 *  2. `normalizeMathDelimiters` — models often emit LaTeX with `\(`…`\)` /
 *     `\[`…`\]` delimiters; remark-math only understands `$`…`$` / `$$`…`$$`.
 *     The rewrite skips inline code spans so code is never mangled.
 */

export interface MarkdownSegment {
  kind: 'md' | 'svg';
  text: string;
}

/**
 * Split content into markdown segments and block-level SVG segments.
 * An SVG block must start at the beginning of a line (leading whitespace
 * allowed) and be the only thing on its line(s) — inline mentions of `<svg>`
 * inside a sentence are left for react-markdown to strip as usual.
 */
export function splitMarkdownSegments(content: string): MarkdownSegment[] {
  const lines = content.split('\n');

  // Mask fenced-code regions (``` or ~~~ fences, including the fence lines
  // themselves) so SVG extraction never runs inside them. An unterminated
  // fence (mid-stream) masks everything to the end, which is correct: that
  // text is code-in-progress, not markdown.
  let fenceOpen = false;
  let fenceChar = '';
  const inFence = lines.map(line => {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (!m) return fenceOpen;
    if (!fenceOpen) { fenceOpen = true; fenceChar = m[1][0]; return true; }
    if (m[1][0] === fenceChar) fenceOpen = false;
    return true; // this line is inside (or closes) the fence
  });

  const out: MarkdownSegment[] = [];
  let buf: string[] = [];
  let bufIsFence = false;
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join('\n');
    if (bufIsFence || !text.includes('<svg')) out.push({ kind: 'md', text });
    else extractSvgBlocks(text, out);
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i] !== bufIsFence) { flush(); bufIsFence = inFence[i]; }
    buf.push(lines[i]);
  }
  flush();
  return out;
}

/** Index just past the `</svg>` matching the `<svg` at `from`, or -1. Handles nested `<svg>` elements. */
function findSvgClose(text: string, from: number): number {
  const re = /<svg(?=[\s>])|<\/svg\s*>/g;
  re.lastIndex = from;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '<svg') depth++;
    else if (--depth === 0) return m.index + m[0].length;
  }
  return -1;
}

function extractSvgBlocks(text: string, out: MarkdownSegment[]): void {
  let pos = 0;
  let last = 0;
  for (;;) {
    const idx = text.indexOf('<svg', pos);
    if (idx === -1) break;
    const lineStart = text.lastIndexOf('\n', idx) + 1;
    const atLineStart = /^[ \t]*$/.test(text.slice(lineStart, idx));
    const end = atLineStart ? findSvgClose(text, idx) : -1;
    // The SVG must fill its line: nothing but whitespace after `</svg>`.
    const lineEnd = end === -1 ? -1 : (() => { const nl = text.indexOf('\n', end); return nl === -1 ? text.length : nl; })();
    if (end === -1 || !/^[ \t]*$/.test(text.slice(end, lineEnd))) {
      pos = idx + 4;
      continue;
    }
    const before = text.slice(last, lineStart);
    if (before.trim()) out.push({ kind: 'md', text: before });
    out.push({ kind: 'svg', text: text.slice(idx, end) });
    last = lineEnd === text.length ? text.length : lineEnd + 1;
    pos = last;
  }
  const rest = text.slice(last);
  if (rest.trim()) out.push({ kind: 'md', text: rest });
}

/**
 * Rewrite model math into the forms remark-math understands:
 *   • `\(`…`\)` → `$`…`$` (inline)
 *   • `\[`…`\]` and single-line `$$…$$` → flow form `$$\n…\n$$` (display —
 *     `$$x$$` on one line inside a paragraph would render as *inline* math)
 *   • currency-looking pairs ("$5 and $10") are escaped so they stay text
 *
 * Inline code spans are left untouched. Replacement functions are used
 * because `'$'`/`'$$'` in replacement *strings* are escape sequences.
 */
export function normalizeMathDelimiters(text: string): string {
  return text
    .split(/(`+[^`]*?`+)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part; // inline code span — leave untouched
      return part
        // \(x\) → $x$
        .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => `$${inner}$`)
        // \[x\] → $$\nx\n$$ (display)
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `$$\n${inner.trim()}\n$$`)
        // $$x$$ on one line → flow form (display)
        .replace(/\$\$([^$\n]+)\$\$/g, (_m, inner: string) => `$$\n${inner.trim()}\n$$`)
        // "…$5 and $10…" — a pair whose closing $ is followed by a digit is
        // money, not math. Escape both dollars so remark-math skips them.
        .replace(/(^|[^\\])\$([^$\n]*?)\$(?=\d)/g, (_m, pre: string, inner: string) => `${pre}\\$${inner}\\$`);
    })
    .join('');
}
