/**
 * Text extraction for supported file kinds.
 *
 * Runs in the browser after upload (no server-side worker in Phase 2), so we
 * cap the amount of text we keep to protect the database and the model
 * context. Anything we cannot read throws a clear, user-facing error — the
 * file is then marked `failed` rather than silently indexed as empty.
 */
import type { FileKind, FileMetadata } from '../../types';
import { normalizeText } from './chunker';

/** Maximum characters of extracted text retained per file. */
export const MAX_EXTRACTED_CHARS = 400_000;
/** Maximum PDF pages we read; large manuals beyond this are truncated (and flagged). */
export const MAX_PDF_PAGES = 300;

export class ExtractionError extends Error {
  constructor(message: string) { super(message); this.name = 'ExtractionError'; }
}

export interface ExtractionResult {
  text: string;
  metadata: Pick<FileMetadata, 'pages' | 'lines' | 'rows' | 'truncated'>;
}

export async function extractText(file: Blob, kind: FileKind): Promise<ExtractionResult> {
  switch (kind) {
    case 'pdf': return extractPdf(file);
    case 'csv': return extractCsv(file);
    case 'json': return extractJson(file);
    case 'text':
    case 'markdown':
    case 'code': return extractPlain(file);
    default: throw new ExtractionError('This file type isn’t supported yet.');
  }
}

async function readAsText(file: Blob): Promise<string> {
  const text = await file.text();
  // Reject binary content that slipped through with a text extension.
  const sample = text.slice(0, 2000);
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) control++;
  }
  if (sample.length > 50 && control / sample.length > 0.1) throw new ExtractionError('This file doesn’t look like readable text.');
  return text;
}

function capped(text: string): { text: string; truncated: boolean } {
  const clean = normalizeText(text);
  if (clean.length <= MAX_EXTRACTED_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

async function extractPlain(file: Blob): Promise<ExtractionResult> {
  const raw = await readAsText(file);
  const { text, truncated } = capped(raw);
  if (!text) throw new ExtractionError('The file is empty.');
  return { text, metadata: { lines: raw.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length, truncated } };
}

async function extractCsv(file: Blob): Promise<ExtractionResult> {
  const raw = await readAsText(file);
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) throw new ExtractionError('The file is empty.');
  // Keep the header with every block of rows so each chunk stays self-describing.
  const header = lines[0];
  const body = lines.slice(1);
  const blocks: string[] = [];
  const ROWS_PER_BLOCK = 25;
  for (let i = 0; i < body.length; i += ROWS_PER_BLOCK) {
    blocks.push([header, ...body.slice(i, i + ROWS_PER_BLOCK)].join('\n'));
  }
  const { text, truncated } = capped((blocks.length ? blocks : [header]).join('\n\n'));
  return { text, metadata: { rows: body.length, truncated } };
}

async function extractJson(file: Blob): Promise<ExtractionResult> {
  const raw = await readAsText(file);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new ExtractionError('The file isn’t valid JSON.'); }
  // Flatten into "path: value" lines so nested keys are searchable.
  const lines: string[] = [];
  flatten(parsed, '', lines, 20_000);
  const { text, truncated } = capped(lines.join('\n'));
  if (!text) throw new ExtractionError('The file is empty.');
  return { text, metadata: { lines: lines.length, truncated: truncated || lines.length >= 20_000 } };
}

function flatten(value: unknown, path: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  if (Array.isArray(value)) {
    if (!value.length) { out.push(`${path || '$'}: []`); return; }
    value.forEach((v, i) => flatten(v, `${path}[${i}]`, out, limit));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) { out.push(`${path || '$'}: {}`); return; }
    for (const [k, v] of entries) flatten(v, path ? `${path}.${k}` : k, out, limit);
    return;
  }
  out.push(`${path || '$'}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function extractPdf(file: Blob): Promise<ExtractionResult> {
  // Lazy-load pdf.js so the chat bundle does not pay for it.
  let pdfjs: typeof import('pdfjs-dist');
  try {
    pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  } catch {
    throw new ExtractionError('The PDF reader could not be loaded. Check your connection and try again.');
  }

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    const msg = String((e as Error)?.message || '').toLowerCase();
    if (msg.includes('password')) throw new ExtractionError('This PDF is password-protected.');
    throw new ExtractionError('This PDF could not be opened. It may be corrupted.');
  }

  const total = doc.numPages;
  const pages = Math.min(total, MAX_PDF_PAGES);
  const parts: string[] = [];
  let chars = 0;
  try {
    for (let i = 1; i <= pages && chars < MAX_EXTRACTED_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      page.cleanup();
      if (text.trim()) { parts.push(`[Page ${i}]\n${text}`); chars += text.length; }
    }
  } finally {
    await doc.loadingTask.destroy().catch(() => { /* already destroyed */ });
  }

  const { text, truncated } = capped(parts.join('\n\n'));
  if (!text) throw new ExtractionError('No readable text was found. Scanned PDFs (images only) aren’t supported yet.');
  return { text, metadata: { pages: total, truncated: truncated || total > pages } };
}

/** Rebuild lines from pdf.js text items, respecting explicit end-of-line markers. */
export function joinTextItems(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    const s = item.str ?? '';
    if (!s && !item.hasEOL) continue;
    out += s;
    out += item.hasEOL ? '\n' : (s.endsWith(' ') || s.endsWith('-') ? '' : ' ');
  }
  return out.replace(/ +$/gm, '');
}
