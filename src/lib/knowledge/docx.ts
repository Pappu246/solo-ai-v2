/**
 * Minimal DOCX reader (Phase 9 document intelligence).
 *
 * A .docx file is a ZIP container; the visible text lives in
 * `word/document.xml` as WordprocessingML. We read it with zero dependencies:
 *
 *  - ZIP: scan the End-Of-Central-Directory record, walk the central
 *    directory (which always carries correct sizes, even when local headers
 *    use data descriptors), then inflate the entry with
 *    `DecompressionStream('deflate-raw')` — available in all modern browsers.
 *  - XML: `DOMParser` + namespace-aware lookup, so any prefix works.
 *
 * Nothing here throws `ExtractionError` (that class lives in `./extract`,
 * which imports this module): failures return `null` and the caller decides
 * the user-facing message. Decompression is capped to stop zip bombs.
 */

/** Uncompressed `word/document.xml` budget — well above any legitimate document. */
const MAX_XML_BYTES = 32 * 1024 * 1024;

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ── ZIP ─────────────────────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipEntryResult {
  data?: Uint8Array;
  /** User-facing reason when the entry exists but cannot be read. */
  error?: string;
}

/**
 * Read one entry from a ZIP archive.
 *
 * Returns `{ data }` on success, `{ error }` when the archive is valid but the
 * entry is unusable (unsupported method, oversized payload), and `null` when
 * the archive or the entry simply cannot be found.
 */
export async function readZipEntry(bytes: Uint8Array, entryName: string): Promise<ZipEntryResult | null> {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate the End Of Central Directory record (scans back over the comment).
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset >= bytes.length) return null;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIG) return null;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    if (name === entryName) {
      // ZIP64 markers mean sizes/offsets live elsewhere — unsupported here.
      if (compSize === 0xffffffff || localOffset === 0xffffffff) return null;
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) return null;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compSize > bytes.length) return null;
      const data = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) return { data: data.slice() };
      if (method !== 8) return { error: 'This .docx file uses an unsupported compression method.' };
      try {
        return { data: await inflateRaw(data) };
      } catch (e) {
        return { error: e instanceof Error && e.message ? e.message : 'This .docx file could not be decompressed.' };
      }
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Your browser cannot read .docx files. Save the document as PDF or plain text and try again.');
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Copy into a fresh ArrayBuffer-backed view: the DOM write() wants a
  // BufferSource backed by a plain ArrayBuffer (TS 5.7+ distinguishes
  // Uint8Array<ArrayBuffer> from Uint8Array<ArrayBufferLike>).
  const writeDone = (async () => { await writer.write(new Uint8Array(data)); await writer.close(); })();
  // Marked handled so a read-side failure can't surface as an unhandled
  // rejection; the original promise is still awaited below to catch write errors.
  writeDone.catch(() => undefined);

  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_XML_BYTES) throw new Error('This .docx file is too large to read in the browser.');
      parts.push(value);
    }
    await writeDone;
  } catch (error) {
    await writeDone.catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    throw error instanceof Error ? error : new Error('This .docx file could not be decompressed.');
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ── WordprocessingML ────────────────────────────────────────────────────────

/**
 * Extract paragraph lines from `word/document.xml`.
 *
 * Returns `null` when the XML cannot be parsed (corrupted body), or an array
 * of paragraph strings (possibly empty) otherwise. Runs in document order and
 * picks up table cells, lists and text boxes — all of which wrap `w:p`.
 */
export function readDocxText(xml: string): string[] | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) {
    return null;
  }

  const paragraphs = doc.getElementsByTagNameNS(WORD_NS, 'p');
  const lines: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const runs = paragraphs[i].getElementsByTagNameNS(WORD_NS, 't');
    let line = '';
    for (let j = 0; j < runs.length; j++) line += runs[j].textContent ?? '';
    if (line.trim()) lines.push(line);
  }

  // Rare fallback: content outside any paragraph (unusual producers).
  if (!lines.length) {
    const runs = doc.getElementsByTagNameNS(WORD_NS, 't');
    let all = '';
    for (let i = 0; i < runs.length; i++) all += runs[i].textContent ?? '';
    if (all.trim()) lines.push(all);
  }
  return lines;
}

/** The single entry every DOCX body lives in. */
export const DOCX_BODY_ENTRY = 'word/document.xml';

/** DOCX MIME type (bucket allow-list + upload metadata). */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
