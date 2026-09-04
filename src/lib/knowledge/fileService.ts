/**
 * FileService — orchestrates the file lifecycle:
 *
 *   register row (uploading) → upload bytes to Storage → processing
 *     → extract text → chunk → save chunks → ready
 *     ↘ any failure → failed (with a user-facing reason)
 *
 * Kept free of React so hooks and tests can drive it directly. Callers get
 * progress through `onChange`, which fires with the latest row on every
 * transition.
 */
import type { KnowledgeFile, FileMetadata } from '../../types';
import { filesApi, chunksApi, storagePathFor } from './api';
import { detectFileType, describeUnsupported, KNOWLEDGE_MAX_FILE_SIZE } from './fileTypes';
import { extractText, ExtractionError } from './extract';
import { chunkText, makePreview } from './chunker';
import { AppError } from '../errors';

export interface UploadOptions {
  userId: string;
  projectId?: string | null;
  conversationId?: string | null;
  onChange?: (file: KnowledgeFile) => void;
}

export class FileValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'FileValidationError'; }
}

/** Synchronous pre-flight so the UI can reject bad files before any network call. */
export function validateFile(file: { name: string; size: number; type?: string }): string | null {
  if (!file.name.trim()) return 'The file has no name.';
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > KNOWLEDGE_MAX_FILE_SIZE) return `${file.name}: larger than 20 MB.`;
  if (!detectFileType(file)) return `${file.name}: ${describeUnsupported(file.name)}`;
  return null;
}

function reasonFor(e: unknown): string {
  if (e instanceof ExtractionError || e instanceof FileValidationError) return e.message;
  if (e instanceof AppError) return e.detail ? `${e.message}: ${e.detail}` : e.message;
  const msg = (e as Error)?.message || 'Unknown error';
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

function isMissingStorageObject(e: unknown): boolean {
  const app = e instanceof AppError ? e : null;
  const text = `${app?.message ?? ''} ${app?.detail ?? ''} ${(e as Error)?.message ?? ''}`.toLowerCase();
  return text.includes('404') || text.includes('not found') || text.includes('no such object') || text.includes('object not found');
}

export const fileService = {
  validate: validateFile,

  /**
   * Upload and index one file. Resolves with the final row (ready or failed);
   * only rejects when the row could not be created at all.
   */
  async upload(file: File, opts: UploadOptions): Promise<KnowledgeFile> {
    const problem = validateFile(file);
    if (problem) throw new FileValidationError(problem);
    const type = detectFileType(file)!;

    const id = crypto.randomUUID();
    const metadata: FileMetadata = { kind: type.kind, extension: type.extension, uploaded: false };
    let row = await filesApi.insert({
      id,
      user_id: opts.userId,
      project_id: opts.projectId ?? null,
      conversation_id: opts.conversationId ?? null,
      name: file.name,
      mime_type: type.mime,
      size: file.size,
      storage_path: storagePathFor(opts.userId, id, file.name),
      metadata,
    });
    opts.onChange?.(row);

    // 1. Bytes → Storage
    try {
      await filesApi.upload(row.storage_path, file, type.mime);
    } catch (e) {
      return fail(row, `Upload failed. ${reasonFor(e)}`, opts.onChange);
    }
    row = await transition(row, { status: 'processing', metadata: { ...metadata, uploaded: true } }, opts.onChange);

    // 2. Extract → chunk → index
    return this.process(row, file, opts.onChange);
  },

  /**
   * (Re)process an already-uploaded file. When `blob` is omitted the original
   * is downloaded from Storage — used by "Retry processing".
   */
  async process(row: KnowledgeFile, blob?: Blob, onChange?: (f: KnowledgeFile) => void): Promise<KnowledgeFile> {
    const started = performance.now();
    const type = detectFileType({ name: row.name, type: row.mime_type });
    if (!type) return fail(row, describeUnsupported(row.name), onChange);
    if (row.status !== 'processing') row = await transition(row, { status: 'processing', error: null }, onChange);

    try {
      const source = blob ?? await filesApi.download(row.storage_path);
      const { text, metadata: extracted } = await extractText(source, type.kind);
      const chunks = chunkText(text);
      if (!chunks.length) throw new ExtractionError('No readable text was found in this file.');
      await chunksApi.replaceForFile(row.id, row.user_id, chunks);
      const metadata: FileMetadata = {
        ...row.metadata,
        ...extracted,
        uploaded: true,
        processed_at: new Date().toISOString(),
        processing_ms: Math.round(performance.now() - started),
      };
      return transition(row, {
        status: 'ready',
        error: null,
        chunk_count: chunks.length,
        char_count: text.length,
        preview: makePreview(text),
        metadata,
      }, onChange);
    } catch (e) {
      return fail(row, reasonFor(e), onChange);
    }
  },

  /** Delete the row (chunks cascade) and the stored object. */
  async remove(row: KnowledgeFile): Promise<void> {
    // Keep the DB row if Storage reports an unexpected failure. This avoids
    // silently orphaning a stored object with no metadata/cleanup path. A
    // missing object is safe to treat as already deleted.
    try {
      await filesApi.removeObject(row.storage_path);
    } catch (e) {
      if (!isMissingStorageObject(e)) throw e;
    }
    await filesApi.remove(row.id);
  },
};

async function transition(row: KnowledgeFile, patch: Parameters<typeof filesApi.update>[1], onChange?: (f: KnowledgeFile) => void): Promise<KnowledgeFile> {
  await filesApi.update(row.id, patch);
  const next = { ...row, ...patch, updated_at: new Date().toISOString() } as KnowledgeFile;
  onChange?.(next);
  return next;
}

async function fail(row: KnowledgeFile, reason: string, onChange?: (f: KnowledgeFile) => void): Promise<KnowledgeFile> {
  try {
    return await transition(row, { status: 'failed', error: reason }, onChange);
  } catch {
    // Even if the DB write fails, tell the UI what happened.
    const next = { ...row, status: 'failed', error: reason } as KnowledgeFile;
    onChange?.(next);
    return next;
  }
}
