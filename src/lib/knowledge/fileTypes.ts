/**
 * Which files the knowledge layer can actually extract text from.
 * Anything not listed here is rejected up front — we never pretend to
 * "process" a format we cannot read.
 */
import type { FileKind, FileStatus } from '../../types';

export const KNOWLEDGE_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — matches the bucket limit
export const KNOWLEDGE_MAX_FILES_PER_UPLOAD = 10;

interface KindRule { kind: FileKind; mime: string; label: string }

/** Extension → canonical kind + the MIME type we store/upload with. */
const BY_EXTENSION: Record<string, KindRule> = {
  pdf:  { kind: 'pdf',      mime: 'application/pdf', label: 'PDF' },
  txt:  { kind: 'text',     mime: 'text/plain',      label: 'Text' },
  text: { kind: 'text',     mime: 'text/plain',      label: 'Text' },
  log:  { kind: 'text',     mime: 'text/plain',      label: 'Log' },
  md:   { kind: 'markdown', mime: 'text/markdown',   label: 'Markdown' },
  markdown: { kind: 'markdown', mime: 'text/markdown', label: 'Markdown' },
  csv:  { kind: 'csv',      mime: 'text/csv',        label: 'CSV' },
  tsv:  { kind: 'csv',      mime: 'text/csv',        label: 'TSV' },
  json: { kind: 'json',     mime: 'application/json', label: 'JSON' },
  // Common code / config files — stored as text/plain so the bucket allow-list stays tight.
  js: code('JavaScript'), mjs: code('JavaScript'), cjs: code('JavaScript'), jsx: code('JSX'),
  ts: code('TypeScript'), tsx: code('TSX'), py: code('Python'), rb: code('Ruby'), go: code('Go'),
  rs: code('Rust'), java: code('Java'), kt: code('Kotlin'), swift: code('Swift'), c: code('C'),
  h: code('C header'), cpp: code('C++'), hpp: code('C++ header'), cs: code('C#'), php: code('PHP'),
  sh: code('Shell'), bash: code('Shell'), zsh: code('Shell'), sql: code('SQL'), html: code('HTML'),
  css: code('CSS'), scss: code('SCSS'), yml: code('YAML'), yaml: code('YAML'), toml: code('TOML'),
  xml: code('XML'), ini: code('INI'), env: code('Env'), dockerfile: code('Dockerfile'),
};

function code(label: string): KindRule { return { kind: 'code', mime: 'text/plain', label }; }

const BY_MIME: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/csv': 'csv',
  'text/tab-separated-values': 'csv',
  'application/json': 'json',
};

export function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const idx = base.lastIndexOf('.');
  if (idx > 0) return base.slice(idx + 1).toLowerCase();
  // Extension-less names we still recognise (e.g. "Dockerfile").
  return BY_EXTENSION[base.toLowerCase()] ? base.toLowerCase() : '';
}

export interface DetectedFileType {
  kind: FileKind;
  /** MIME type to upload with (normalised, always on the bucket allow-list). */
  mime: string;
  label: string;
  extension: string;
}

/**
 * Decide whether we can process a file. Prefers the extension (browsers often
 * report an empty or generic MIME type for code/markdown files) and falls back
 * to the reported MIME type.
 */
export function detectFileType(file: { name: string; type?: string }): DetectedFileType | null {
  const extension = extensionOf(file.name);
  const byExt = BY_EXTENSION[extension];
  if (byExt) return { ...byExt, extension };
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  const kind = BY_MIME[mime];
  if (kind) return { kind, mime: kind === 'code' ? 'text/plain' : mime, label: kind.toUpperCase(), extension };
  // Generic text/* from the browser (e.g. text/x-python) is fine to read as text.
  if (mime.startsWith('text/')) return { kind: 'text', mime: 'text/plain', label: 'Text', extension };
  return null;
}

export const KNOWLEDGE_ACCEPT = [
  '.pdf', '.txt', '.text', '.log', '.md', '.markdown', '.csv', '.tsv', '.json',
  ...Object.keys(BY_EXTENSION).filter(e => BY_EXTENSION[e].kind === 'code').map(e => `.${e}`),
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
].join(',');

export function describeUnsupported(name: string): string {
  const ext = extensionOf(name);
  return ext
    ? `.${ext} files aren’t supported yet. Use PDF, text, Markdown, CSV, JSON or code files.`
    : 'This file type isn’t supported yet. Use PDF, text, Markdown, CSV, JSON or code files.';
}

/** Human labels for the file lifecycle. */
export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};
