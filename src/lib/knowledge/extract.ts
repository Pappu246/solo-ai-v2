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

type PdfJs = typeof import('pdfjs-dist');
interface PdfReader {
  pdfjs: PdfJs;
  worker: InstanceType<PdfJs['PDFWorker']>;
}

// Share initialization AND the PDFWorker, not just its underlying port. Passing
// the worker explicitly to getDocument prevents one document's destroy() from
// tearing down a worker that another concurrent upload is still using.
let pdfReaderPromise: Promise<PdfReader> | undefined;

function getPdfReader(): Promise<PdfReader> {
  return pdfReaderPromise ??= loadPdfReader().catch(error => {
    pdfReaderPromise = undefined; // allow retry after a transient loading failure
    throw error;
  });
}

async function loadPdfReader(): Promise<PdfReader> {
  // Keep both the reader and worker out of the initial chat bundle.
  const pdfjs = await import('pdfjs-dist');
  let port: Worker | undefined;
  let worker: PdfReader['worker'] | undefined;
  try {
    const { default: BundledPdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
    port = new BundledPdfWorker();
    // A supplied workerPort bypasses pdf.js's startup/error checks. CSP and
    // failed script loads may report errors asynchronously, so wait for ready.
    await waitForPdfWorker(port);
    pdfjs.GlobalWorkerOptions.workerPort = port;
    worker = pdfjs.PDFWorker.create({ port });
    await worker.promise;
    return { pdfjs, worker };
  } catch (workerError) {
    worker?.destroy();
    port?.terminate();
    pdfjs.GlobalWorkerOptions.workerPort = null;
    console.error('[PDF worker] Bundled worker unavailable; trying main-thread extraction.', workerError);

    try {
      // pdf.js v6 removed disableWorker: true. Its main-thread equivalent is
      // to register WorkerMessageHandler BEFORE creating PDFWorker. Resolve
      // our bundled asset explicitly, once, instead of letting pdf.js create
      // a module Worker and then runtime-import workerSrc as a fake fallback.
      const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      type WorkerModule = { WorkerMessageHandler?: { setup?: unknown } };
      const workerModule: WorkerModule = await import(/* @vite-ignore */ workerUrl);
      if (typeof workerModule.WorkerMessageHandler?.setup !== 'function') {
        throw new Error('The PDF worker module did not export WorkerMessageHandler.');
      }
      (globalThis as typeof globalThis & { pdfjsWorker: WorkerModule }).pdfjsWorker = workerModule;
      worker = pdfjs.PDFWorker.create({});
      await worker.promise;
      return { pdfjs, worker };
    } catch (fallbackError) {
      worker?.destroy();
      throw new Error(`PDF worker startup failed: ${pdfErrorDetail(workerError)} Main-thread fallback failed: ${pdfErrorDetail(fallbackError)}`);
    }
  }
}

function waitForPdfWorker(port: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      port.removeEventListener('message', onMessage);
      port.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.sourceName === 'worker' && event.data?.action === 'ready') finish();
    };
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      finish(new Error(event.message || 'The browser blocked or could not load the PDF worker script.'));
    };
    // Don't leave a file stuck in "processing" if a browser never reports a
    // blocked worker's error event. No document bytes have been transferred yet.
    const timeout = setTimeout(() => finish(new Error('The PDF worker did not start within 10 seconds.')), 10_000);
    port.addEventListener('message', onMessage);
    port.addEventListener('error', onError);
  });
}

function pdfErrorDetail(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const { name, message } = error as { name?: unknown; message?: unknown };
    const label = typeof name === 'string' && name !== 'Error' ? name : '';
    if (typeof message === 'string' && message) return label ? `${label}: ${message}` : message;
    return label;
  }
  return error == null ? '' : String(error);
}

/** Classify PDF failures without hiding the original diagnostic behind "corrupt". */
export function describePdfError(error: unknown): string {
  const detail = pdfErrorDetail(error);
  const message = detail.toLowerCase();
  let summary: string;
  if (/password|encrypted/.test(message)) {
    summary = 'This PDF is password-protected. Remove the password and upload it again.';
  } else if (/empty|zero bytes|no (?:readable |extractable )?text|no pages/.test(message)) {
    summary = 'No readable text was found in this PDF. It may be empty or scanned (images only); scanned PDFs aren’t supported yet.';
  } else if (/worker|dynamically imported module|module script|importing a module|failed to fetch|loading chunk|chunkloaderror|securityerror|content security policy|\bcsp\b|\bmime\b/.test(message)) {
    summary = 'The PDF reader could not start. Check your connection and browser security settings, then reload and try again.';
  } else if (/invalidpdf|invalid pdf|invalid xref|invalid cross-reference|corrupt|formaterror/.test(message)) {
    summary = 'This PDF could not be opened because it is invalid or corrupted.';
  } else {
    summary = 'This PDF could not be processed.';
  }
  return detail ? `${summary} Details: ${detail}` : summary;
}

async function extractPdf(file: Blob): Promise<ExtractionResult> {
  let task: ReturnType<PdfJs['getDocument']> | undefined;
  try {
    if (!file.size) throw new ExtractionError('The PDF file is empty.');
    const { pdfjs, worker } = await getPdfReader();
    task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), worker });
    const doc = await task.promise;
    const total = doc.numPages;
    const pages = Math.min(total, MAX_PDF_PAGES);
    const parts: string[] = [];
    let chars = 0;
    for (let i = 1; i <= pages && chars < MAX_EXTRACTED_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      page.cleanup();
      if (text.trim()) { parts.push(`[Page ${i}]\n${text}`); chars += text.length; }
    }
    const { text, truncated } = capped(parts.join('\n\n'));
    if (!text) throw new ExtractionError('The PDF contains no readable text.');
    return { text, metadata: { pages: total, truncated: truncated || total > pages } };
  } catch (error) {
    const message = describePdfError(error);
    console.error('[PDF extraction]', message, error);
    throw new ExtractionError(message);
  } finally {
    // Clean up rejected loading tasks and page/text failures too, but keep the
    // explicitly supplied shared worker alive for other uploads and retries.
    await task?.destroy().catch(() => { /* already destroyed */ });
  }
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
