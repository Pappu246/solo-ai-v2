import { describe, it, expect } from 'vitest';
import { detectFileType, describeUnsupported, KNOWLEDGE_ACCEPT, extensionOf } from './fileTypes';
import { chunkText, normalizeText, makePreview, DEFAULT_CHUNK_SIZE, MAX_CHUNK_CHARS } from './chunker';
import { extractText, ExtractionError, joinTextItems, MAX_EXTRACTED_CHARS } from './extract';
import { extractKeywords, selectMemories, buildChatContext, toSources } from './retriever';
import { splitHighlights, groupResults } from './search';
import type { Memory } from '../../types';

describe('fileTypes', () => {
  it('recognises the supported document formats by extension and/or MIME type', () => {
    expect(detectFileType({ name: 'report.pdf', type: 'application/pdf' })?.kind).toBe('pdf');
    expect(detectFileType({ name: 'notes.txt', type: 'text/plain' })?.kind).toBe('text');
    expect(detectFileType({ name: 'README.md', type: '' })?.kind).toBe('markdown');
    expect(detectFileType({ name: 'data.csv', type: 'text/csv' })?.kind).toBe('csv');
    expect(detectFileType({ name: 'config.json', type: 'application/json' })?.kind).toBe('json');
    expect(detectFileType({ name: 'app.ts', type: '' })?.kind).toBe('code');
    expect(detectFileType({ name: 'main.py', type: 'text/x-python' })?.kind).toBe('code');
  });

  it('does not pretend to support binary or office formats', () => {
    expect(detectFileType({ name: 'deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBeNull();
    expect(detectFileType({ name: 'sheet.xlsx', type: '' })).toBeNull();
    expect(detectFileType({ name: 'photo.png', type: 'image/png' })).toBeNull();
    expect(detectFileType({ name: 'archive.zip', type: 'application/zip' })).toBeNull();
    expect(detectFileType({ name: 'binary', type: 'application/octet-stream' })).toBeNull();
    expect(describeUnsupported('deck.pptx')).toMatch(/\.pptx files aren’t supported/i);
    expect(describeUnsupported('noext')).toMatch(/^This file type/);
  });

  it('exposes an accept list that matches detection', () => {
    for (const ext of ['.pdf', '.txt', '.md', '.csv', '.json']) expect(KNOWLEDGE_ACCEPT).toContain(ext);
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noext')).toBe('');
  });
});

describe('chunker', () => {
  it('normalises line endings, NUL bytes and whitespace noise', () => {
    expect(normalizeText('a\r\nb\u0000c \t d\n\n\n\ne')).toBe('a\nbc d\n\ne');
  });

  it('returns nothing for empty text and one chunk for short text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
    expect(chunkText('Hello world.')).toEqual(['Hello world.']);
  });

  it('splits long documents on paragraph boundaries with overlap and never exceeds the max size', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'lorem ipsum dolor sit amet '.repeat(12)}`.trim());
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(c.length).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE + 400); // overlap + boundary slack
    }
    // Every paragraph is present in at least one chunk.
    for (const p of paragraphs) expect(chunks.some(c => c.includes(p.slice(0, 40)))).toBe(true);
    // Neighbouring chunks share context: the second chunk opens with the tail of the first.
    const overlapProbe = chunks[0].slice(-40).trim().split(' ').slice(1).join(' ');
    expect(chunks[1].startsWith(overlapProbe.slice(0, 15)) || chunks[1].includes(overlapProbe)).toBe(true);
  });

  it('hard-splits pathological text with no boundaries', () => {
    const chunks = chunkText('x'.repeat(DEFAULT_CHUNK_SIZE * 3 + 10));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE);
  });

  it('builds a compact single-line preview', () => {
    const preview = makePreview('# Title\n\nFirst line.\nSecond   line.\n'.repeat(40));
    expect(preview.length).toBeLessThanOrEqual(281);
    expect(preview).not.toContain('\n');
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('extractText', () => {
  const blob = (s: string, type = 'text/plain') => new Blob([s], { type });

  it('reads plain text, markdown and code as-is', async () => {
    expect((await extractText(blob('hello\nworld'), 'text')).text).toBe('hello\nworld');
    expect((await extractText(blob('# Title\n\ncontent'), 'markdown')).text).toContain('# Title');
    const code = await extractText(blob('export const a = 1;\nexport const b = 2;\n'), 'code');
    expect(code.text).toContain('export const a = 1;');
    expect(code.metadata.lines).toBe(2);
  });

  it('turns CSV into readable rows and reports the row count', async () => {
    const res = await extractText(blob('name,age\nAda,36\n"Grace, H",45\n', 'text/csv'), 'csv');
    expect(res.metadata.rows).toBe(2);
    expect(res.text).toContain('name');
    expect(res.text).toContain('Ada');
    expect(res.text).toContain('Grace, H');
  });

  it('flattens JSON into searchable key/value lines and rejects invalid JSON', async () => {
    const res = await extractText(blob(JSON.stringify({ user: { name: 'Ada', tags: ['math', 'code'] }, total: 2 })), 'json');
    expect(res.text).toMatch(/user\.name.*Ada/);
    expect(res.text).toMatch(/user\.tags\[1\].*code/);
    await expect(extractText(blob('{ not json'), 'json')).rejects.toBeInstanceOf(ExtractionError);
  });

  it('rejects binary content masquerading as text', async () => {
    const bytes = new Uint8Array(2000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 7 === 0 ? 0 : (i * 31) % 256;
    await expect(extractText(new Blob([bytes]), 'text')).rejects.toBeInstanceOf(ExtractionError);
  });

  it('truncates very large text instead of failing and flags it', async () => {
    const res = await extractText(blob('a'.repeat(MAX_EXTRACTED_CHARS + 5000)), 'text');
    expect(res.text.length).toBeLessThanOrEqual(MAX_EXTRACTED_CHARS);
    expect(res.metadata.truncated).toBe(true);
  });

  it('joins PDF text items respecting end-of-line markers', () => {
    expect(joinTextItems([{ str: 'Hello', hasEOL: false }, { str: 'world', hasEOL: true }, { str: 'Next' }])).toBe('Hello world\nNext');
  });
});

describe('retriever helpers', () => {
  it('extracts meaningful keywords and drops stopwords / numbers / filler', () => {
    expect(extractKeywords('Can you please summarise the document about quarterly revenue in 2024?')).toEqual(['quarterly', 'revenue']);
    expect(extractKeywords('hi')).toEqual([]);
    expect(extractKeywords('the the the')).toEqual([]);
  });

  it('selects memories for the scope, highest importance first, within budget', () => {
    const mk = (over: Partial<Memory>): Memory => ({
      id: crypto.randomUUID(), user_id: 'u', project_id: null, type: 'fact', content: 'x', importance: 3, source: 'user',
      source_conversation_id: null, created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
    });
    const memories = [
      mk({ content: 'global low', importance: 1 }),
      mk({ content: 'global high', importance: 5 }),
      mk({ content: 'project A', project_id: 'A', importance: 4 }),
      mk({ content: 'project B', project_id: 'B', importance: 5 }),
    ];
    // Project-scoped memories are more specific than generic global facts, so they come first;
    // within a tier, importance decides.
    expect(selectMemories(memories, 'A').map(m => m.content)).toEqual(['project A', 'global high', 'global low']);
    expect(selectMemories(memories, 'A').some(m => m.content === 'project B')).toBe(false);
    expect(selectMemories(memories, null).map(m => m.content)).toEqual(['global high', 'global low']);
    expect(selectMemories(memories, 'A', 12).map(m => m.content)).toEqual(['project A']);
    expect(selectMemories(memories, 'A', 2000, 1)).toHaveLength(1);
  });

  it('builds no context when nothing applies and a trimmed context otherwise', () => {
    expect(buildChatContext({ project: null, memories: [], knowledge: [] })).toBeUndefined();
    const ctx = buildChatContext({
      project: { id: 'p', user_id: 'u', name: 'Launch', description: '', instructions: 'Be brief', archived: false, created_at: '', updated_at: '' },
      memories: [],
      knowledge: [{ file_id: 'f', file_name: 'a.md', chunk_index: 0, content: 'excerpt', rank: 1 }],
    });
    expect(ctx?.project).toEqual({ name: 'Launch', instructions: 'Be brief' });
    expect(ctx?.knowledge).toEqual([{ file_id: 'f', file_name: 'a.md', chunk_index: 0, content: 'excerpt' }]);
    expect(ctx?.memories).toBeUndefined();
  });

  it('collapses chunks into per-file sources preserving excerpt indexes', () => {
    const sources = toSources([
      { file_id: 'f1', file_name: 'a.md', chunk_index: 2, content: '', rank: 1 },
      { file_id: 'f1', file_name: 'a.md', chunk_index: 0, content: '', rank: 1 },
      { file_id: 'f2', file_name: 'b.pdf', chunk_index: 5, content: '', rank: 1 },
    ]);
    expect(sources).toEqual([
      { file_id: 'f1', file_name: 'a.md', chunk_indexes: [0, 2] },
      { file_id: 'f2', file_name: 'b.pdf', chunk_indexes: [5] },
    ]);
  });
});

describe('search helpers', () => {
  it('splits headline markers into highlighted segments without rendering HTML', () => {
    expect(splitHighlights('the ⟦quick⟧ brown ⟦fox⟧')).toEqual([
      { text: 'the ', hit: false }, { text: 'quick', hit: true }, { text: ' brown ', hit: false }, { text: 'fox', hit: true },
    ]);
    expect(splitHighlights('<b>x</b>')).toEqual([{ text: '<b>x</b>', hit: false }]);
    expect(splitHighlights(null)).toEqual([]);
  });

  it('groups results by kind', () => {
    const grouped = groupResults([
      { kind: 'file', id: '1', title: 'a', snippet: null, conversation_id: null, project_id: null, updated_at: '', rank: 1 },
      { kind: 'memory', id: '2', title: 'b', snippet: null, conversation_id: null, project_id: null, updated_at: '', rank: 1 },
      { kind: 'file', id: '3', title: 'c', snippet: null, conversation_id: null, project_id: null, updated_at: '', rank: 1 },
    ]);
    expect(grouped.file?.map(r => r.id)).toEqual(['1', '3']);
    expect(grouped.memory?.map(r => r.id)).toEqual(['2']);
    expect(grouped.project).toBeUndefined();
  });
});
