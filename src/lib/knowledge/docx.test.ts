import { describe, it, expect } from 'vitest';
import { readZipEntry, readDocxText, DOCX_BODY_ENTRY } from './docx';
import { extractText, ExtractionError } from './extract';

// ── Minimal ZIP builder (STORED and DEFLATE entries) ────────────────────────

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writing = (async () => {
    const writer = stream.writable.getWriter();
    await writer.write(new Uint8Array(data));
    await writer.close();
  })();
  const buf = await new Response(stream.readable).arrayBuffer();
  await writing;
  return new Uint8Array(buf);
}

interface ZipInput { name: string; content: string; deflate?: boolean }

async function buildZip(entries: ZipInput[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const push = (arr: Uint8Array[], bytes: Uint8Array) => { arr.push(bytes); };
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const entry of entries) {
    const raw = encoder.encode(entry.content);
    const useDeflate = Boolean(entry.deflate);
    const body = useDeflate ? await deflateRaw(raw) : raw;
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(raw);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(useDeflate ? 8 : 0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    push(chunks, local);
    push(chunks, nameBytes);
    push(chunks, body);
    const centralEntry = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(useDeflate ? 8 : 0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]);
    push(central, centralEntry);
    push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}

const documentXml = (paragraphs: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
  paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')
}</w:body></w:document>`;

async function docxBlob(paragraphs: string[], opts: { deflate?: boolean; extraEntries?: boolean } = {}): Promise<Blob> {
  const entries: ZipInput[] = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types/>', deflate: opts.deflate },
    { name: DOCX_BODY_ENTRY, content: documentXml(paragraphs), deflate: opts.deflate },
    ...(opts.extraEntries ? [{ name: 'word/styles.xml', content: '<w:styles/>' }] : []),
  ];
  const bytes = await buildZip(entries);
  return new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ── readZipEntry ────────────────────────────────────────────────────────────

describe('readZipEntry', () => {
  it('reads stored and deflated entries', async () => {
    const stored = await buildZip([{ name: 'a.txt', content: 'hello stored' }]);
    const deflated = await buildZip([{ name: 'a.txt', content: 'hello deflated '.repeat(10), deflate: true }]);
    expect(new TextDecoder().decode((await readZipEntry(stored, 'a.txt'))!.data!)).toBe('hello stored');
    expect(new TextDecoder().decode((await readZipEntry(deflated, 'a.txt'))!.data!)).toBe('hello deflated '.repeat(10));
  });

  it('returns null for missing entries and non-zip bytes', async () => {
    const zip = await buildZip([{ name: 'a.txt', content: 'x' }]);
    expect(await readZipEntry(zip, 'nope.txt')).toBeNull();
    expect(await readZipEntry(encoder.encode('just some plain text, definitely not a zip'), 'a.txt')).toBeNull();
    expect(await readZipEntry(new Uint8Array(4), 'a.txt')).toBeNull();
  });

  it('returns null for archives missing the central directory signature', async () => {
    const zip = await buildZip([{ name: 'a.txt', content: 'x' }]);
    const corrupted = zip.slice();
    // Clobber every central-directory signature so the walk bails out.
    for (let i = 0; i < corrupted.length - 4; i++) {
      if (corrupted[i] === 0x50 && corrupted[i + 1] === 0x4b && corrupted[i + 2] === 0x01 && corrupted[i + 3] === 0x02) {
        corrupted[i] = 0;
      }
    }
    expect(await readZipEntry(corrupted, 'a.txt')).toBeNull();
  });
});

// ── readDocxText ────────────────────────────────────────────────────────────

describe('readDocxText', () => {
  it('extracts paragraphs in document order', () => {
    const lines = readDocxText(documentXml(['First paragraph.', 'Second paragraph.']));
    expect(lines).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('works with any namespace prefix, not only w:', () => {
    const xml = '<wp:document xmlns:wp="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><wp:p><wp:r><wp:t>prefixed</wp:t></wp:r></wp:p></wp:document>';
    expect(readDocxText(xml)).toEqual(['prefixed']);
  });

  it('skips empty paragraphs and joins runs inside one paragraph', () => {
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:p><w:r><w:t>run one </w:t></w:r><w:r><w:t>run two</w:t></w:r></w:p>'
      + '<w:p/>'
      + '</w:document>';
    expect(readDocxText(xml)).toEqual(['run one run two']);
  });

  it('returns null for malformed XML', () => {
    expect(readDocxText('<w:document><w:p>')).toBeNull();
    expect(readDocxText('definitely not xml <<<')).toBeNull();
  });

  it('returns an empty list for a document with no text', () => {
    expect(readDocxText('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')).toEqual([]);
  });
});

// ── extractText integration ─────────────────────────────────────────────────

describe('extractText (docx)', () => {
  it('extracts paragraphs from a deflated docx (the real-world case)', async () => {
    const blob = await docxBlob(['Quarterly revenue grew 12%.', 'Churn fell to 2.1%.'], { deflate: true, extraEntries: true });
    const result = await extractText(blob, 'docx');
    expect(result.text).toBe('Quarterly revenue grew 12%.\nChurn fell to 2.1%.');
    expect(result.metadata.lines).toBe(2);
    expect(result.metadata.truncated).toBe(false);
  });

  it('extracts from a stored (uncompressed) docx', async () => {
    const blob = await docxBlob(['Plain stored paragraph.'], { deflate: false });
    expect((await extractText(blob, 'docx')).text).toBe('Plain stored paragraph.');
  });

  it('rejects non-zip bytes with a clear message', async () => {
    const blob = new Blob(['PK not really a document'], { type: 'application/octet-stream' });
    await expect(extractText(blob, 'docx')).rejects.toThrow(/isn’t a valid \.docx/);
  });

  it('rejects a zip that is not a docx (no word/document.xml)', async () => {
    const bytes = await buildZip([{ name: 'readme.txt', content: 'hello' }]);
    await expect(extractText(new Blob([new Uint8Array(bytes)]), 'docx')).rejects.toThrow(/isn’t a valid \.docx/);
  });

  it('rejects an empty document body', async () => {
    const blob = await docxBlob([]);
    await expect(extractText(blob, 'docx')).rejects.toBeInstanceOf(ExtractionError);
    await expect(extractText(blob, 'docx')).rejects.toThrow(/empty/);
  });

  it('caps very long documents at MAX_EXTRACTED_CHARS and flags truncation', async () => {
    const paragraphs = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} ${'lorem ipsum dolor sit '.repeat(140)}`);
    const blob = await docxBlob(paragraphs, { deflate: true });
    const result = await extractText(blob, 'docx');
    expect(result.text.length).toBeLessThanOrEqual(400_000);
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.lines).toBe(300);
  });
});
