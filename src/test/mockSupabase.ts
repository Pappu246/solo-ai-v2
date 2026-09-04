/**
 * In-memory stand-in for the subset of the Supabase client used by the app.
 * Supports: auth.getSession/onAuthStateChange, from(table).select/insert/update/delete
 * with eq/neq/in/is/ilike/order/limit/single chaining, storage.from(bucket)
 * upload/download/remove/createSignedUrl, and the Phase 2 RPCs.
 *
 * Row-level security is simulated: every table row has a `user_id`, reads and
 * writes are scoped to the signed-in user, and inserting rows that claim
 * another owner fails with 42501 — exactly what Postgres RLS does. Storage
 * objects are scoped by the first path segment (`<user_id>/…`).
 * Phase 1 tests run unchanged on top of this (same tables, same defaults).
 */
import { vi } from 'vitest';

type Row = Record<string, unknown>;

const RLS_TABLES = new Set(['conversations', 'messages', 'projects', 'files', 'file_chunks', 'memories']);
const OWNED_BY_USER_ID = new Set(['conversations', 'projects', 'files', 'file_chunks', 'memories']);

export function createMockSupabase(opts: { userId?: string | null } = {}) {
  const tables: Record<string, Row[]> = { conversations: [], messages: [], projects: [], files: [], file_chunks: [], memories: [] };
  const storage: Record<string, { bucket: string; bytes: Uint8Array; contentType: string }> = {};
  let user = opts.userId === null ? null : { id: opts.userId ?? 'user-1', email: 'test@example.com' };
  const sessionFor = () => (user ? { access_token: 'token', user } : null);
  const rlsError = { code: '42501', message: 'new row violates row-level security policy', details: null, hint: null };

  /** Ownership check used by the RLS simulation. Messages are owned via their conversation. */
  const visible = (table: string, r: Row): boolean => {
    if (!RLS_TABLES.has(table)) return true;
    if (!user) return false;
    if (table === 'messages') return (tables.conversations ?? []).some(c => c.id === r.conversation_id && c.user_id === user!.id);
    return r.user_id === user.id;
  };

  function query(table: string) {
    const rows = () => (tables[table] ||= []);
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let single = false;
    let limit: number | null = null;

    const apply = () => {
      let out = rows().filter(r => visible(table, r) && filters.every(f => f(r)));
      for (const o of [...orders].reverse()) {
        out = [...out].sort((a, b) => {
          const av = a[o.col] as string | number | boolean, bv = b[o.col] as string | number | boolean;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      if (limit !== null) out = out.slice(0, limit);
      return out;
    };

    const exec = async () => {
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]) as Row[];
        if (RLS_TABLES.has(table)) {
          if (!user) return { data: null, error: rlsError };
          for (const r of items) {
            if (OWNED_BY_USER_ID.has(table) && r.user_id !== user.id) return { data: null, error: rlsError };
            if (table === 'messages' && !visible('messages', r)) return { data: null, error: rlsError };
            if (table === 'files' && String(r.storage_path ?? '').split('/')[0] !== user.id) return { data: null, error: rlsError };
            if (table === 'file_chunks' && !(tables.files ?? []).some(f => f.id === r.file_id && f.user_id === user!.id)) return { data: null, error: rlsError };
          }
        }
        const now = new Date().toISOString();
        const inserted = items.map(r => ({ id: crypto.randomUUID(), created_at: now, updated_at: now, archived: false, ...r }));
        rows().push(...inserted);
        return { data: single ? inserted[0] : inserted, error: null };
      }
      if (op === 'update') {
        const matched = apply();
        for (const r of matched) Object.assign(r, payload, { updated_at: new Date().toISOString() });
        return { data: matched, error: null };
      }
      if (op === 'delete') {
        const matched = new Set(apply());
        tables[table] = rows().filter(r => !matched.has(r));
        cascade(table, [...matched]);
        return { data: null, error: null };
      }
      const data = apply();
      if (single && data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned', details: null, hint: null } };
      return { data: single ? data[0] ?? null : data, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return builder; },
      update: (p: Row) => { op = 'update'; payload = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return builder; },
      neq: (col: string, val: unknown) => { filters.push(r => r[col] !== val); return builder; },
      is: (col: string, val: unknown) => { filters.push(r => (val === null ? r[col] === null || r[col] === undefined : r[col] === val)); return builder; },
      in: (col: string, vals: unknown[]) => { filters.push(r => vals.includes(r[col])); return builder; },
      ilike: (col: string, pattern: string) => {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
        filters.push(r => re.test(String(r[col] ?? '')));
        return builder;
      },
      order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return builder; },
      limit: (n: number) => { limit = n; return builder; },
      single: () => { single = true; return builder; },
      maybeSingle: () => { single = true; return builder; },
      abortSignal: () => builder,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return builder;
  }

  /** Mirror the migration's foreign-key behaviour. */
  function cascade(table: string, removed: Row[]) {
    const ids = new Set(removed.map(r => r.id));
    if (table === 'conversations') {
      tables.messages = (tables.messages ?? []).filter(m => !ids.has(m.conversation_id));
      for (const f of tables.files ?? []) if (ids.has(f.conversation_id)) f.conversation_id = null;
      for (const m of tables.memories ?? []) if (ids.has(m.source_conversation_id)) m.source_conversation_id = null;
    }
    if (table === 'projects') {
      for (const c of tables.conversations ?? []) if (ids.has(c.project_id)) c.project_id = null;
      for (const f of tables.files ?? []) if (ids.has(f.project_id)) f.project_id = null;
      tables.memories = (tables.memories ?? []).filter(m => !ids.has(m.project_id));
    }
    if (table === 'files') {
      tables.file_chunks = (tables.file_chunks ?? []).filter(c => !ids.has(c.file_id));
    }
  }

  // ── Storage (private bucket, owner = first path segment) ──────────────────
  const ownsPath = (path: string) => Boolean(user) && path.split('/')[0] === user!.id;
  const storageError = (message: string, statusCode = '403') => ({ name: 'StorageApiError', message, statusCode });
  const bucketApi = (bucket: string) => ({
    upload: vi.fn(async (path: string, body: Blob | ArrayBuffer | Uint8Array | File, o?: { contentType?: string; upsert?: boolean }) => {
      if (!ownsPath(path)) return { data: null, error: storageError('new row violates row-level security policy') };
      if (storage[path] && !o?.upsert) return { data: null, error: storageError('The resource already exists', '409') };
      const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body);
      storage[path] = { bucket, bytes, contentType: o?.contentType ?? (body instanceof Blob ? body.type : 'application/octet-stream') };
      return { data: { path }, error: null };
    }),
    download: vi.fn(async (path: string) => {
      const obj = storage[path];
      if (!obj || !ownsPath(path)) return { data: null, error: storageError('Object not found', '404') };
      return { data: new Blob([obj.bytes as BlobPart], { type: obj.contentType }), error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      const removed: Array<{ name: string }> = [];
      for (const p of paths) if (storage[p] && ownsPath(p)) { delete storage[p]; removed.push({ name: p }); }
      return { data: removed, error: null };
    }),
    createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
      if (!storage[path] || !ownsPath(path)) return { data: null, error: storageError('Object not found', '404') };
      return { data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t&expires=${expiresIn}` }, error: null };
    }),
  });

  // ── RPCs (approximate the SQL functions over the in-memory rows) ───────────
  const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
  const rpc = vi.fn((name: string, args: Row) => {
    const run = async () => {
      if (!user) return { data: null, error: { code: '42501', message: 'permission denied', details: null, hint: null } };
      if (name === 'match_file_chunks') {
        const words = ((args.p_words as string[]) ?? []).map(w => w.toLowerCase());
        const fileIds = new Set((args.p_file_ids as string[]) ?? []);
        const limit = Math.min(Number(args.p_limit ?? 24), 50);
        const readyFiles = new Map((tables.files ?? []).filter(f => f.user_id === user!.id && f.status === 'ready' && fileIds.has(f.id as string)).map(f => [f.id as string, f]));
        const scored = (tables.file_chunks ?? [])
          .filter(c => c.user_id === user!.id && readyFiles.has(c.file_id as string))
          .map(c => {
            const t = tokens(String(c.content));
            const rank = words.reduce((n, w) => n + t.filter(x => x === w || x.startsWith(w)).length, 0);
            return { file_id: c.file_id, file_name: readyFiles.get(c.file_id as string)!.name, chunk_index: c.chunk_index, content: c.content, rank };
          })
          .filter(c => c.rank > 0)
          .sort((a, b) => b.rank - a.rank || (a.chunk_index as number) - (b.chunk_index as number))
          .slice(0, limit);
        return { data: scored, error: null };
      }
      if (name === 'search_all') {
        const q = String(args.p_query ?? '').trim();
        if (q.length < 2) return { data: [], error: null };
        const kinds = (args.p_kinds as string[] | null) ?? ['conversation', 'message', 'project', 'file', 'memory'];
        const limit = Math.min(Number(args.p_limit ?? 30), 100);
        const offset = Number(args.p_offset ?? 0);
        const words = tokens(q);
        const hit = (text: string) => { const t = text.toLowerCase(); return words.some(w => t.includes(w)); };
        const snippet = (text: string) => {
          let out = text.slice(0, 160);
          for (const w of words) out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '⟦$1⟧');
          return out;
        };
        const mine = (rowsOf: string) => (tables[rowsOf] ?? []).filter(r => visible(rowsOf, r));
        const out: Row[] = [];
        if (kinds.includes('conversation')) for (const c of mine('conversations')) if (hit(String(c.title))) out.push({ kind: 'conversation', id: c.id, title: c.title, snippet: null, conversation_id: c.id, project_id: c.project_id ?? null, updated_at: c.updated_at, rank: 1 });
        if (kinds.includes('message')) for (const m of mine('messages')) if (hit(String(m.content))) { const c = tables.conversations.find(x => x.id === m.conversation_id); out.push({ kind: 'message', id: m.id, title: c?.title ?? 'Chat', snippet: snippet(String(m.content)), conversation_id: m.conversation_id, project_id: c?.project_id ?? null, updated_at: m.created_at, rank: 0.8 }); }
        if (kinds.includes('project')) for (const p of mine('projects')) if (hit(`${p.name} ${p.description ?? ''} ${p.instructions ?? ''}`)) out.push({ kind: 'project', id: p.id, title: p.name, snippet: p.description ? snippet(String(p.description)) : null, conversation_id: null, project_id: p.id, updated_at: p.updated_at, rank: 1 });
        if (kinds.includes('file')) for (const f of mine('files')) if (hit(`${f.name} ${f.preview ?? ''}`)) out.push({ kind: 'file', id: f.id, title: f.name, snippet: f.preview ? snippet(String(f.preview)) : null, conversation_id: f.conversation_id ?? null, project_id: f.project_id ?? null, updated_at: f.updated_at, rank: 0.9 });
        if (kinds.includes('memory')) for (const m of mine('memories')) if (hit(String(m.content))) out.push({ kind: 'memory', id: m.id, title: String(m.content).slice(0, 80), snippet: snippet(String(m.content)), conversation_id: m.source_conversation_id ?? null, project_id: m.project_id ?? null, updated_at: m.updated_at, rank: 0.9 });
        return { data: out.slice(offset, offset + limit), error: null };
      }
      return { data: null, error: { code: '42883', message: `function ${name} does not exist`, details: null, hint: null } };
    };
    const p = run();
    return Object.assign(p, { abortSignal: () => p });
  });

  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: sessionFor() } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ data: { session: sessionFor() }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn((table: string) => query(table)),
    storage: { from: vi.fn((bucket: string) => bucketApi(bucket)) },
    rpc,
  };

  return {
    client,
    tables,
    storage,
    get user() { return user; },
    /** Switch the signed-in identity (simulates a different browser session). */
    setUser(next: { id: string; email: string } | null) { user = next; },
  };
}

export interface MockFetchOptions {
  model?: string;
  failStatus?: number;
  models?: unknown[];
  /**
   * Deterministic pacing hook. Called before each word is emitted with the
   * word index; the stream waits for the returned promise. Use it to hold the
   * stream open at a known point (e.g. to test Stop mid-reply).
   */
  gate?: (index: number) => Promise<void>;
  /** Capture each POST body (used to assert what context reaches the server). */
  onRequest?: (body: Record<string, unknown>) => void;
}

/** Build a fetch mock for the chat Edge Function that streams the given text. */
export function mockChatFetch(reply: string, opts: MockFetchOptions = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method === 'GET') {
      return new Response(JSON.stringify({ models: opts.models ?? [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (opts.onRequest && typeof init.body === 'string') opts.onRequest(JSON.parse(init.body));
    if (opts.failStatus) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a minute.' }), { status: opts.failStatus });
    }
    const enc = new TextEncoder();
    const words = reply.split(' ');
    // Emit one word per pull so the consumer sees partial output; like a real
    // fetch body, abort surfaces as an AbortError on the next read.
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (opts.gate) await opts.gate(i); else await new Promise(r => setTimeout(r, 5));
        if (init.signal?.aborted) { c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
        if (i < words.length) {
          const chunk = (i ? ' ' : '') + words[i++];
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
          return;
        }
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Model-Used': opts.model ?? 'gpt-oss-120b', 'X-Model-Name': 'GPT OSS 120B', 'X-Route-Category': 'conversation' } });
  });
}
