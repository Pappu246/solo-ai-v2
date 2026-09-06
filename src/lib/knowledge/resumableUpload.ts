/**
 * Resumable uploads to Supabase Storage over the TUS protocol.
 *
 * Why not `supabase.storage.upload()`? That call is a single multipart POST:
 * it has no progress, cannot be cancelled or resumed, and the whole request is
 * retried from byte 0 after any hiccup — which is exactly how large uploads
 * fail on real connections. The Storage TUS endpoint accepts the file in
 * fixed 6 MB chunks (Supabase requires this chunk size), each chunk is retried
 * independently, and an interrupted upload continues from the last accepted
 * offset instead of starting over. There is no artificial size cap here; the
 * effective limit is whatever the bucket / project plan allows.
 *
 * Security notes:
 *   - Credentials travel only in request headers (`Authorization`, `apikey`),
 *     never in the URL or the TUS metadata, so they cannot leak into logs.
 *   - The object key (`<user_id>/<file_id>/<name>`) is enforced server-side by
 *     the existing storage RLS policies; the client cannot pick another
 *     user's folder.
 *   - `x-upsert` is "false": an existing object is never silently replaced.
 */
import { Upload as TusUpload, type DetailedError } from 'tus-js-client';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../supabase';
import { AppError } from '../errors';

/** Supabase Storage only accepts this chunk size for resumable uploads. */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const TUS_RETRY_DELAYS = [0, 1000, 3000, 5000, 10000];

export interface ResumableUploadOptions {
  bucket: string;
  /** Object key inside the bucket, e.g. `<user_id>/<file_id>/<name>`. */
  path: string;
  contentType: string;
  /** Progress callback with bytes sent so far and the total size. */
  onProgress?: (sent: number, total: number) => void;
  /** Aborting this signal cancels the upload and removes the partial object. */
  signal?: AbortSignal;
  /** Overrides for tests (endpoint, chunk size, retry pacing, client). */
  endpoint?: string;
  chunkSize?: number;
  retryDelays?: number[] | null;
  uploadFactory?: (file: Blob, options: ConstructorParameters<typeof TusUpload>[1]) => TusUpload;
}

/** Error raised when the caller cancels an upload. `name` mirrors the DOM convention. */
export class UploadCancelledError extends Error {
  constructor(message = 'Upload cancelled') { super(message); this.name = 'AbortError'; }
}

export function isUploadCancelled(e: unknown): boolean {
  return e instanceof UploadCancelledError || (e instanceof Error && e.name === 'AbortError');
}

/** `${SUPABASE_URL}/storage/v1/upload/resumable` — the TUS creation endpoint. */
export function resumableEndpoint(baseUrl: string = SUPABASE_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`;
}

/**
 * Only transient failures are worth retrying. Auth, permission and validation
 * problems (4xx other than 408/429) are final: retrying would just burn time
 * before surfacing the same, actionable error.
 */
export function shouldRetryUpload(status: number | undefined, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  if (status === undefined || status === 0) return true; // network error / no response
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/** A user-facing reason for a failed upload; the raw response stays in `detail`. */
export function describeUploadFailure(status: number | undefined, body: string | undefined, fallback: string): AppError {
  const text = (body || '').slice(0, 300);
  if (status === 401) return new AppError('Your session has expired. Please sign in again.', 401, text);
  if (status === 403) return new AppError('You don’t have permission to upload here.', 403, text || 'row-level security');
  if (status === 409) return new AppError('A file with this name already exists in storage.', 409, text);
  if (status === 413) return new AppError('This file is larger than your storage plan allows.', 413, text);
  if (status === 415) return new AppError('This file type is not allowed in storage.', 415, text);
  if (status === 429) return new AppError('Too many uploads at once. Please wait a moment and try again.', 429, text);
  if (status && status >= 500) return new AppError('Storage is temporarily unavailable. Please try again.', status, text);
  if (status === 0 || status === undefined) return new AppError('Connection lost during upload. Check your network and try again.', undefined, text || fallback);
  return new AppError('Upload failed.', status, text || fallback);
}

/** Pull the HTTP status / body out of a tus DetailedError, if present. */
export function readTusError(e: unknown): { status?: number; body?: string; message: string } {
  const err = e as Partial<DetailedError> & { message?: string };
  const res = err?.originalResponse ?? null;
  let status: number | undefined;
  let body: string | undefined;
  try { status = res ? res.getStatus() : undefined; } catch { status = undefined; }
  try { body = res ? res.getBody() : undefined; } catch { body = undefined; }
  // Network errors have a request but no response.
  if (status === undefined && err?.originalRequest) status = 0;
  return { status, body, message: String(err?.message ?? e ?? 'Upload failed') };
}

/**
 * Upload `file` to `bucket/path`. Resolves when the server has accepted the
 * final chunk; rejects with an `AppError` (or `UploadCancelledError`).
 */
export async function uploadResumable(file: Blob, opts: ResumableUploadOptions): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new AppError('Your session has expired. Please sign in again.', 401);
  if (opts.signal?.aborted) throw new UploadCancelledError();

  const endpoint = opts.endpoint ?? resumableEndpoint();
  const retryDelays = opts.retryDelays === undefined ? TUS_RETRY_DELAYS : opts.retryDelays;
  const maxAttempts = retryDelays?.length ?? 0;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; opts.signal?.removeEventListener('abort', onAbort); fn(); };

    const upload = (opts.uploadFactory ?? ((f, o) => new TusUpload(f, o)))(file, {
      endpoint,
      // Auth lives in headers only — never in the URL or metadata.
      headers: {
        authorization: `Bearer ${session.access_token}`,
        ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
        'x-upsert': 'false',
      },
      metadata: {
        bucketName: opts.bucket,
        objectName: opts.path,
        contentType: opts.contentType,
        cacheControl: '3600',
      },
      chunkSize: opts.chunkSize ?? TUS_CHUNK_SIZE,
      retryDelays,
      // Supabase's endpoint does not implement the creation-with-upload extension.
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      // Resume state is keyed per object path (which embeds the file id), so a
      // reload mid-upload can pick the same upload back up.
      storeFingerprintForResuming: true,
      fingerprint: async () => `solo-tus:${opts.bucket}:${opts.path}:${file.size}`,
      onShouldRetry: (err, attempt) => shouldRetryUpload(readTusError(err).status, attempt, maxAttempts),
      onProgress: (sent, total) => opts.onProgress?.(sent, total),
      onError: (err) => {
        const info = readTusError(err);
        finish(() => reject(describeUploadFailure(info.status, info.body, info.message)));
      },
      onSuccess: () => finish(resolve),
    });

    function onAbort() {
      // `abort(true)` also sends the TUS termination request so no partial
      // object is left behind in Storage.
      upload.abort(true).catch(() => { /* best effort */ });
      finish(() => reject(new UploadCancelledError()));
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    // Continue an interrupted upload of the same object when one exists.
    upload.findPreviousUploads()
      .then(previous => { if (previous.length) upload.resumeFromPreviousUpload(previous[0]); })
      .catch(() => { /* fall through to a fresh upload */ })
      .finally(() => { if (!settled) upload.start(); });
  });
}
