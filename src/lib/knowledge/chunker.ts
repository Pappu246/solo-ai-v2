/**
 * Split extracted text into retrieval-sized chunks.
 *
 * Pure function — no React, no Supabase — so it can be unit-tested directly.
 * Chunks break on paragraph boundaries where possible, then sentences, then
 * hard-wrap. Adjacent chunks share a small overlap so a fact that straddles a
 * boundary is still retrievable.
 */

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  size?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlap?: number;
}

export const DEFAULT_CHUNK_SIZE = 1400;
export const DEFAULT_CHUNK_OVERLAP = 150;
/** Hard database limit for a single chunk (see file_chunks.content CHECK). */
export const MAX_CHUNK_CHARS = 8000;

/** Collapse whitespace noise without destroying paragraph structure. */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\0').join('')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = Math.min(Math.max(opts.size ?? DEFAULT_CHUNK_SIZE, 200), MAX_CHUNK_CHARS);
  const overlap = Math.min(Math.max(opts.overlap ?? DEFAULT_CHUNK_OVERLAP, 0), Math.floor(size / 3));
  const clean = normalizeText(text);
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  // First pass: paragraphs, packing several small ones together.
  const units = splitUnits(clean, size);
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) { current = unit; continue; }
    if (current.length + 1 + unit.length <= size) { current = `${current}\n${unit}`; continue; }
    chunks.push(current);
    current = overlap ? `${tail(current, overlap)}${unit}` : unit;
    // Overlap can push a unit over the limit; keep the hard cap.
    if (current.length > size) { const parts = hardWrap(current, size); chunks.push(...parts.slice(0, -1)); current = parts[parts.length - 1]; }
  }
  if (current) chunks.push(current);
  return chunks.map(c => c.trim()).filter(Boolean);
}

/** Paragraphs, with oversized paragraphs further split into sentences/lines. */
function splitUnits(text: string, size: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= size) { out.push(p); continue; }
    // Sentences (or lines for code/CSV-like content).
    const sentences = p.includes('. ') && !looksTabular(p)
      ? p.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
      : p.split('\n');
    for (const s of sentences) {
      const t = s.trim();
      if (!t) continue;
      if (t.length <= size) out.push(t);
      else out.push(...hardWrap(t, size));
    }
  }
  return out;
}

function looksTabular(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 3) return false;
  const withSep = lines.filter(l => /[,\t|;]/.test(l)).length;
  return withSep / lines.length > 0.6;
}

function hardWrap(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    // Prefer breaking at whitespace near the limit.
    let cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Last `n` chars of `text`, snapped forward to a word boundary. */
function tail(text: string, n: number): string {
  if (text.length <= n) return `${text}\n`;
  const slice = text.slice(-n);
  const firstSpace = slice.indexOf(' ');
  const snapped = firstSpace > 0 && firstSpace < n / 2 ? slice.slice(firstSpace + 1) : slice;
  return `${snapped.trim()}\n`;
}

/** Short, single-line preview used in lists and search results. */
export function makePreview(text: string, max = 280): string {
  const oneLine = normalizeText(text).replace(/\s*\n\s*/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max).trimEnd()}…` : oneLine;
}
