/**
 * Resumable (TUS) upload transport — verified offline with a fake `Upload`
 * that records the options it was constructed with and lets each test drive
 * progress / success / failure / abort deterministically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = await vi.hoisted(async () => (await import('../../test/mockSupabase')).createMockSupabase());
vi.mock('../supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk_test',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import type { Upload as TusUpload } from 'tus-js-client';
import {
  uploadResumable, resumableEndpoint, shouldRetryUpload, describeUploadFailure, readTusError,
  UploadCancelledError, isUploadCancelled, TUS_CHUNK_SIZE,
} from './resumableUpload';
import { filesApi, RESUMABLE_THRESHOLD } from './api';
import { fileService, UploadCancelled } from './fileService';
import { toFriendlyError } from '../errors';

type TusOptions = ConstructorParameters<typeof TusUpload>[1];

/** Minimal stand-in for tus-js-client's Upload with hooks to drive the outcome. */
class FakeUpload {
  static instances: FakeUpload[] = [];
  started = false;
  aborted: boolean[] = [];
  previous: unknown[] = [];
  constructor(public file: Blob, public options: TusOptions) { FakeUpload.instances.push(this); }
  start() { this.started = true; }
  async abort(shouldTerminate?: boolean) { this.aborted.push(Boolean(shouldTerminate)); }
  async findPreviousUploads() { return this.previous as never[]; }
  resumeFromPreviousUpload(p: unknown) { this.resumedFrom = p; }
  resumedFrom: unknown = null;
  // Drivers
  progress(sent: number, total: number) { this.options.onProgress?.(sent, total); }
  succeed() { this.options.onSuccess?.({ lastResponse: fakeResponse(204, '') }); }
  failWith(status: number | undefined, body = '') {
    const err = Object.assign(new Error(`tus: failed (${status ?? 'network'})`), {
      originalRequest: { getMethod: () => 'PATCH', getURL: () => 'https://x/upload', getHeader: () => undefined },
      originalResponse: status === undefined ? null : fakeResponse(status, body),
    });
    this.options.onError?.(err as never);
  }
}
const fakeResponse = (status: number, body: string) => ({ getStatus: () => status, getBody: () => body, getHeader: () => undefined, getUnderlyingObject: () => null });
const factory = (file: Blob, options: TusOptions) => new FakeUpload(file, options) as unknown as TusUpload;
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  FakeUpload.instances = [];
  for (const t of Object.keys(mock.tables)) mock.tables[t] = [];
  for (const k of Object.keys(mock.storage)) delete mock.storage[k];
  mock.setUser({ id: 'alice', email: 'alice@example.com' });
});

describe('resumable upload transport', () => {
  it('targets the Storage TUS endpoint with credentials in headers only — never in the URL or metadata', async () => {
    const file = new Blob(['x'.repeat(10)], { type: 'text/plain' });
    const done = uploadResumable(file, { bucket: 'knowledge', path: 'alice/f1/a.txt', contentType: 'text/plain', uploadFactory: factory });
    await flush();
    const up = FakeUpload.instances[0];
    expect(up.started).toBe(true);
    expect(up.options.endpoint).toBe('https://x.supabase.co/storage/v1/upload/resumable');
    expect(up.options.endpoint).not.toContain('token');
    expect(up.options.headers).toMatchObject({ authorization: 'Bearer token', apikey: 'pk_test', 'x-upsert': 'false' });
    expect(up.options.metadata).toEqual({ bucketName: 'knowledge', objectName: 'alice/f1/a.txt', contentType: 'text/plain', cacheControl: '3600' });
    expect(JSON.stringify(up.options.metadata)).not.toContain('token');
    expect(up.options.chunkSize).toBe(TUS_CHUNK_SIZE);
    expect(TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024);
    expect(up.options.uploadDataDuringCreation).toBe(false);
    up.succeed();
    await expect(done).resolves.toBeUndefined();
  });

  it('reports byte progress and resolves on success', async () => {
    const seen: Array<[number, number]> = [];
    const done = uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: factory, onProgress: (s, t) => seen.push([s, t]) });
    await flush();
    const up = FakeUpload.instances[0];
    up.progress(1, 3); up.progress(3, 3); up.succeed();
    await done;
    expect(seen).toEqual([[1, 3], [3, 3]]);
  });

  it('resumes a previous upload of the same object instead of starting over', async () => {
    const original = factory;
    const resuming = (file: Blob, options: TusOptions) => {
      const up = original(file, options) as unknown as FakeUpload;
      up.previous = [{ uploadUrl: 'https://x/upload/abc', size: 3, metadata: {}, creationTime: '', urlStorageKey: 'k', parallelUploadUrls: null }];
      return up as unknown as TusUpload;
    };
    const done = uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: resuming });
    await flush();
    const up = FakeUpload.instances[0];
    expect(up.resumedFrom).toMatchObject({ uploadUrl: 'https://x/upload/abc' });
    expect(up.started).toBe(true);
    up.succeed();
    await done;
  });

  it('cancels through the AbortSignal: terminates the partial upload and rejects with an AbortError', async () => {
    const controller = new AbortController();
    const done = uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: factory, signal: controller.signal });
    await flush();
    const up = FakeUpload.instances[0];
    up.progress(1, 3);
    controller.abort();
    await expect(done).rejects.toBeInstanceOf(UploadCancelledError);
    expect(up.aborted).toEqual([true]); // abort(shouldTerminate = true)
    // Late callbacks after cancel are ignored.
    up.succeed(); up.failWith(500);
  });

  it('rejects immediately when the signal is already aborted, without creating an upload', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: factory, signal: controller.signal })).rejects.toSatisfy(isUploadCancelled);
    expect(FakeUpload.instances).toHaveLength(0);
  });

  it('fails with a friendly, status-specific error and keeps the raw body in detail', async () => {
    const run = async (status: number | undefined, body = '') => {
      const done = uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: factory });
      await flush();
      FakeUpload.instances.pop()!.failWith(status, body);
      return done.catch(e => e);
    };
    const forbidden = await run(403, 'new row violates row-level security policy');
    expect(toFriendlyError(forbidden).title).toBe('No access');
    expect(forbidden.detail).toContain('row-level security');
    expect(toFriendlyError(await run(401)).title).toBe('Signed out');
    expect((await run(413)).message).toMatch(/larger than your storage plan/);
    expect((await run(409)).message).toMatch(/already exists/);
    expect((await run(415)).message).toMatch(/not allowed/);
    expect((await run(503)).message).toMatch(/temporarily unavailable/);
    expect((await run(undefined)).message).toMatch(/Connection lost/);
  });

  it('requires a signed-in session and never sends anonymous uploads', async () => {
    mock.setUser(null);
    await expect(uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: factory })).rejects.toMatchObject({ status: 401 });
    expect(FakeUpload.instances).toHaveLength(0);
  });
});

describe('retry policy', () => {
  it('retries transient failures only, up to the configured attempts', () => {
    expect(shouldRetryUpload(undefined, 0, 5)).toBe(true); // network
    expect(shouldRetryUpload(0, 0, 5)).toBe(true);
    expect(shouldRetryUpload(500, 0, 5)).toBe(true);
    expect(shouldRetryUpload(503, 4, 5)).toBe(true);
    expect(shouldRetryUpload(429, 0, 5)).toBe(true);
    expect(shouldRetryUpload(408, 0, 5)).toBe(true);
    expect(shouldRetryUpload(500, 5, 5)).toBe(false); // exhausted
    expect(shouldRetryUpload(401, 0, 5)).toBe(false);
    expect(shouldRetryUpload(403, 0, 5)).toBe(false);
    expect(shouldRetryUpload(409, 0, 5)).toBe(false);
    expect(shouldRetryUpload(413, 0, 5)).toBe(false);
  });

  it('wires the policy into the tus options', async () => {
    const done = uploadResumable(new Blob(['abc']), { bucket: 'knowledge', path: 'alice/f/a.txt', contentType: 'text/plain', uploadFactory: factory, retryDelays: [0, 10] });
    await flush();
    const up = FakeUpload.instances[0];
    const err = (status: number) => ({ originalRequest: {}, originalResponse: fakeResponse(status, '') }) as never;
    expect(up.options.onShouldRetry?.(err(502), 0, up.options)).toBe(true);
    expect(up.options.onShouldRetry?.(err(502), 2, up.options)).toBe(false);
    expect(up.options.onShouldRetry?.(err(403), 0, up.options)).toBe(false);
    up.succeed();
    await done;
  });

  it('helpers: endpoint, error reading and message mapping', () => {
    expect(resumableEndpoint('https://p.supabase.co/')).toBe('https://p.supabase.co/storage/v1/upload/resumable');
    expect(readTusError(new Error('boom'))).toEqual({ status: undefined, body: undefined, message: 'boom' });
    expect(readTusError({ originalRequest: {}, originalResponse: null, message: 'net' }).status).toBe(0);
    expect(describeUploadFailure(500, 'x'.repeat(500), 'f').detail).toHaveLength(300);
    expect(describeUploadFailure(418, '', 'fallback')).toMatchObject({ message: 'Upload failed.', detail: 'fallback' });
  });
});

describe('filesApi.upload transport selection', () => {
  it('uses one request for small files and the resumable path at the threshold', async () => {
    const small = new Blob(['tiny'], { type: 'text/plain' });
    await filesApi.upload('alice/s/small.txt', small, 'text/plain');
    expect(mock.storage['alice/s/small.txt']).toBeDefined();

    // Force the resumable branch without allocating 6 MB: the real tus client
    // is constructed here, so stub its network by spying on XMLHttpRequest.
    const big = { size: RESUMABLE_THRESHOLD, type: 'text/plain', slice: () => new Blob([]) } as unknown as Blob;
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', class { open = xhr; setRequestHeader = vi.fn(); send = vi.fn(); abort = vi.fn(); upload = {}; addEventListener = vi.fn(); });
    const controller = new AbortController();
    const p = filesApi.upload('alice/b/big.txt', big, 'text/plain', { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toSatisfy(isUploadCancelled);
    vi.unstubAllGlobals();
    expect(mock.storage['alice/b/big.txt']).toBeUndefined();
  });

  it('honours cancellation on the simple path before and after the request', async () => {
    const pre = new AbortController(); pre.abort();
    await expect(filesApi.upload('alice/c/a.txt', new Blob(['a']), 'text/plain', { signal: pre.signal })).rejects.toSatisfy(isUploadCancelled);
    expect(mock.storage['alice/c/a.txt']).toBeUndefined();

    // Abort while the request is in flight → object is removed again.
    const during = new AbortController();
    const original = mock.client.storage.from;
    mock.client.storage.from = vi.fn((bucket: string) => {
      const api = original(bucket);
      const upload = api.upload;
      api.upload = vi.fn(async (...args: Parameters<typeof upload>) => { during.abort(); return upload(...args); }) as typeof upload;
      return api;
    }) as typeof original;
    try {
      await expect(filesApi.upload('alice/c/b.txt', new Blob(['b']), 'text/plain', { signal: during.signal })).rejects.toSatisfy(isUploadCancelled);
    } finally { mock.client.storage.from = original; }
    expect(mock.storage['alice/c/b.txt']).toBeUndefined();
  });
});

describe('fileService × cancellation', () => {
  const textFile = (name: string, content: string) => new File([content], name, { type: 'text/plain' });

  it('cancelling mid-upload removes the row and the partial object and rejects with UploadCancelled', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const original = mock.client.storage.from;
    mock.client.storage.from = vi.fn((bucket: string) => {
      const api = original(bucket);
      const upload = api.upload;
      api.upload = vi.fn(async (...args: Parameters<typeof upload>) => { controller.abort(); return upload(...args); }) as typeof upload;
      return api;
    }) as typeof original;
    let error: unknown;
    try {
      await fileService.upload(textFile('big.txt', 'payload'), { userId: 'alice', signal: controller.signal, onChange: f => seen.push(f.status) });
    } catch (e) { error = e; } finally { mock.client.storage.from = original; }
    expect(error).toBeInstanceOf(UploadCancelled);
    expect((error as UploadCancelled).fileId).toBeTruthy();
    expect(seen).toEqual(['uploading']);
    expect(mock.tables.files).toHaveLength(0);
    expect(Object.keys(mock.storage)).toHaveLength(0);
    expect(mock.tables.file_chunks).toHaveLength(0);
  });

  it('a cancel after the bytes landed still wins over indexing', async () => {
    const controller = new AbortController();
    let error: unknown;
    try {
      await fileService.upload(textFile('late.txt', 'payload'), {
        userId: 'alice', signal: controller.signal, transport: 'simple',
        onProgress: (_f, sent, total) => { if (sent === total) controller.abort(); },
      });
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(UploadCancelled);
    expect(mock.tables.files).toHaveLength(0);
    expect(mock.tables.file_chunks).toHaveLength(0);
  });

  it('forwards byte progress with the row while uploading', async () => {
    const seen: Array<[string, number, number]> = [];
    const row = await fileService.upload(textFile('p.txt', 'hello world'), { userId: 'alice', onProgress: (f, s, t) => seen.push([f.status, s, t]) });
    expect(row.status).toBe('ready');
    expect(seen).toEqual([['uploading', 0, 11], ['uploading', 11, 11]]);
  });
});
