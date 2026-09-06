/**
 * In-process stand-in for the Supabase HTTP surface the app talks to, wired
 * into a Playwright page with `page.route`. It speaks just enough of each
 * protocol for the real client libraries (auth-js, postgrest-js, storage-js,
 * tus-js-client) to work unmodified:
 *
 *   /auth/v1/token?grant_type=password  → session (JWT-shaped access token)
 *   /auth/v1/user, /auth/v1/logout
 *   /rest/v1/<table>                    → PostgREST subset: select/insert/
 *                                         update/delete, eq/in/is/order/limit,
 *                                         Prefer: return=representation,
 *                                         Accept: application/vnd.pgrst.object+json
 *   /rest/v1/rpc/match_file_chunks, /rest/v1/rpc/search_all
 *   /storage/v1/object/<bucket>/<path>  → single-request upload / download
 *   /storage/v1/object/<bucket>         → DELETE (remove)
 *   /storage/v1/object/sign/<bucket>/…  → signed URL
 *   /storage/v1/upload/resumable        → TUS 1.0.0: POST create, HEAD offset,
 *                                         PATCH chunk, DELETE terminate
 *   /functions/v1/chat                  → GET models; POST streams SSE
 *
 * Row-level security is simulated exactly like the real policies behave over
 * PostgREST: rows of other users are invisible, so cross-user UPDATE/DELETE
 * match 0 rows and `.single()` becomes PGRST116; INSERTs claiming another
 * owner fail with 42501.
 */
import type { Page } from '@playwright/test';

/**
 * The slice of Playwright's `Request` / `Route` the mock actually uses. Playwright's
 * own objects satisfy it, and so does the Node adapter in `mockServer.ts`, which
 * serves the same backend over HTTP for the live demo.
 */
export interface MockRequest {
  method(): string;
  url(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  postDataBuffer(): Buffer | null;
}
export interface MockRoute {
  request(): MockRequest;
  fulfill(response: { status?: number; headers?: Record<string, string>; body?: string | Buffer }): Promise<void>;
}

export const SUPABASE_URL = 'https://e2e-mock.supabase.co';
export const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'e2e@example.com' };
export const OTHER_USER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' };
export const PASSWORD = 'correct horse battery';

type Row = Record<string, unknown>;

export interface ChatReplyOptions {
  /** Reply text; `context` is the request body's context (project/memories/knowledge). */
  reply?: (body: { messages: Array<{ role: string; content: string }>; context?: Record<string, unknown> }) => string;
  /** Milliseconds between streamed words (default 15). */
  wordDelayMs?: number;
  /** HTTP failure for the next POST only. */
  failNextWith?: { status: number; error: string; code: string };
}

export interface MockBackendOptions {
  /** Seed rows (all owned by USER unless a `user_id` is set). */
  conversations?: Row[];
  messages?: Row[];
  files?: Row[];
  projects?: Row[];
  memories?: Row[];
  /** Start the browser session already signed in (default true). */
  signedIn?: boolean;
  chat?: ChatReplyOptions;
  /** Extra latency for every /rest request (to make optimistic states observable). */
  restDelayMs?: number;
  /** Extra latency per TUS PATCH (to make progress/cancel observable). */
  tusPatchDelayMs?: number;
  /** Epoch ms the mock's clock starts at (default: a fixed 2026-06-01 for deterministic tests). */
  clockStart?: number;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unsigned JWT the auth client is happy to decode (`exp` far in the future). */
export function makeAccessToken(user: { id: string; email: string }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, iat: Math.floor(Date.now() / 1000) }));
  return `${header}.${payload}.${b64url('sig')}`;
}

function authUser(user: { id: string; email: string }) {
  const now = new Date().toISOString();
  return { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, email_confirmed_at: now, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: now, updated_at: now, is_anonymous: false };
}

function sessionFor(user: { id: string; email: string }) {
  return { access_token: makeAccessToken(user), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `refresh-${user.id}`, user: authUser(user) };
}

export class MockBackend {
  readonly tables: Record<string, Row[]> = { conversations: [], messages: [], projects: [], files: [], file_chunks: [], memories: [] };
  readonly storage = new Map<string, { bucket: string; bytes: Buffer; contentType: string }>();
  readonly tus = new Map<string, { bucket: string; path: string; contentType: string; length: number; received: Buffer[]; offset: number }>();
  /** Every request seen, for assertions (method, path, headers). */
  readonly log: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  private chat: ChatReplyOptions;
  private users = new Map<string, { id: string; email: string }>([USER, OTHER_USER].map(u => [u.id, u]));
  /** Accounts that can sign in with a password (USER by default; sign-ups are added). */
  private passwords = new Map<string, string>([[USER.email, PASSWORD]]);
  private tick: number;
  private readonly opts: MockBackendOptions;

  constructor(opts: MockBackendOptions = {}) {
    this.opts = opts;
    this.tick = opts.clockStart ?? Date.parse('2026-06-01T00:00:00.000Z');
    this.chat = { wordDelayMs: 15, ...opts.chat };
    for (const key of ['conversations', 'messages', 'projects', 'files', 'memories'] as const) {
      for (const row of opts[key] ?? []) this.tables[key].push({ user_id: USER.id, ...row });
    }
  }

  setChat(next: ChatReplyOptions) { this.chat = { ...this.chat, ...next }; }

  /** Strictly increasing clock (mirrors Postgres now() ordering for tests). */
  private now(): string { this.tick = Math.max(this.tick + 1000, this.opts.clockStart ? Date.now() : 0); return new Date(this.tick).toISOString(); }

  /** A session for `user`, as GoTrue would return it. */
  sessionFor(user: { id: string; email: string }) { return sessionFor(user); }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  async install(page: Page): Promise<void> {
    if (this.opts.signedIn !== false) {
      // Persist a session the way auth-js does, so the app boots signed in.
      const session = sessionFor(USER);
      await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [`sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)] as const);
    }
    await page.route(`${SUPABASE_URL}/**`, route => this.handle(route).catch(err => {
      console.error('[mockBackend]', route.request().method(), route.request().url(), err);
      return route.fulfill({ status: 500, body: String(err) });
    }));
  }

  /** Identify the caller from the bearer token's `sub` claim (header only — never a query string). */
  private userFrom(request: MockRequest): { id: string; email: string } | null {
    const auth = request.headers()['authorization'] ?? '';
    if (!auth.startsWith('Bearer ')) return null;
    const parts = auth.slice(7).split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { sub?: string; exp?: number };
      if (!payload.sub || (payload.exp && payload.exp * 1000 < Date.now())) return null;
      return this.users.get(payload.sub) ?? null;
    } catch { return null; }
  }

  /** Answer one request (any transport). */
  async handle(route: MockRoute): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    this.log.push({ method, url: url.pathname + url.search, headers: request.headers() });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({ status, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

    if (url.pathname.startsWith('/auth/v1/')) return this.auth(route, url, method, json);
    if (url.pathname.startsWith('/rest/v1/')) {
      if (this.opts.restDelayMs) await new Promise(r => setTimeout(r, this.opts.restDelayMs));
      return this.rest(route, url, method, json);
    }
    if (url.pathname.startsWith('/storage/v1/upload/resumable')) return this.tusHandle(route, url, method);
    if (url.pathname.startsWith('/storage/v1/')) return this.storageHandle(route, url, method, json);
    if (url.pathname.startsWith('/functions/v1/chat')) return this.chatHandle(route, method, json);
    return json(404, { message: `no mock for ${url.pathname}` });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  private async auth(route: MockRoute, url: URL, method: string, json: (s: number, b: unknown) => Promise<void>) {
    const request = route.request();
    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      if (url.searchParams.get('grant_type') === 'password') {
        const account = [...this.users.values()].find(u => u.email === body.email);
        if (account && this.passwords.get(account.email) === body.password) return json(200, sessionFor(account));
        return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') return json(200, sessionFor(USER));
    }
    if (url.pathname === '/auth/v1/signup' && method === 'POST') {
      // Email sign-up with auto-confirm: the account is usable straight away.
      const body = JSON.parse(request.postData() || '{}') as { email?: string; password?: string };
      if (!body.email || !body.password || body.password.length < 6) return json(422, { code: 422, error_code: 'validation_failed', msg: 'Signup requires a valid email and a password of at least 6 characters' });
      if ([...this.users.values()].some(u => u.email === body.email)) return json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      const account = { id: crypto.randomUUID(), email: body.email };
      this.users.set(account.id, account);
      this.passwords.set(account.email, body.password);
      return json(200, sessionFor(account));
    }
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      const u = this.userFrom(request);
      return u ? json(200, authUser(u)) : json(401, { msg: 'invalid JWT', error_code: 'bad_jwt' });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    return json(404, { msg: `no auth mock for ${url.pathname}` });
  }

  // ── PostgREST ──────────────────────────────────────────────────────────────

  private visible(table: string, row: Row, user: { id: string } | null): boolean {
    if (!user) return false;
    if (table === 'messages') return row.user_id === user.id && this.tables.conversations.some(c => c.id === row.conversation_id && c.user_id === user.id);
    return row.user_id === user.id;
  }

  private parseFilters(url: URL): { filters: Array<(r: Row) => boolean>; orders: Array<{ col: string; asc: boolean }>; limit: number | null; select: string } {
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let limit: number | null = null;
    let select = '*';
    for (const [key, raw] of url.searchParams) {
      if (key === 'select') { select = raw; continue; }
      if (key === 'order') {
        for (const part of raw.split(',')) { const [col, dir] = part.split('.'); orders.push({ col, asc: dir !== 'desc' }); }
        continue;
      }
      if (key === 'limit') { limit = Number(raw); continue; }
      if (key === 'offset' || key === 'on_conflict' || key === 'columns') continue;
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot), value = raw.slice(dot + 1);
      const col = key;
      if (op === 'eq') filters.push(r => String(r[col]) === value);
      else if (op === 'neq') filters.push(r => String(r[col]) !== value);
      else if (op === 'is') filters.push(r => (value === 'null' ? r[col] === null || r[col] === undefined : String(r[col]) === value));
      else if (op === 'in') { const vals = value.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')); filters.push(r => vals.includes(String(r[col]))); }
      else if (op === 'ilike') { const re = new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i'); filters.push(r => re.test(String(r[col] ?? ''))); }
      else throw new Error(`unsupported filter ${key}=${raw}`);
    }
    return { filters, orders, limit, select };
  }

  private project(row: Row, select: string): Row {
    if (select === '*' || select === '') return row;
    const out: Row = {};
    for (const col of select.split(',').map(s => s.trim())) if (col in row) out[col] = row[col];
    return out;
  }

  private async rest(route: MockRoute, url: URL, method: string, json: (s: number, b: unknown, h?: Record<string, string>) => Promise<void>) {
    const request = route.request();
    const user = this.userFrom(request);
    const name = url.pathname.slice('/rest/v1/'.length);
    if (name.startsWith('rpc/')) return this.rpc(name.slice(4), JSON.parse(request.postData() || '{}'), user, json);
    const rows = (this.tables[name] ||= []);
    const { filters, orders, limit, select } = this.parseFilters(url);
    const accept = request.headers()['accept'] ?? '';
    const single = accept.includes('vnd.pgrst.object+json');
    const prefer = request.headers()['prefer'] ?? '';
    const wantsRows = prefer.includes('return=representation');
    const rls = { code: '42501', message: 'new row violates row-level security policy for table "' + name + '"', details: null, hint: null };
    const noRow = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null };

    const matched = () => {
      let out = rows.filter(r => this.visible(name, r, user) && filters.every(f => f(r)));
      for (const o of [...orders].reverse()) out = [...out].sort((a, b) => { const av = a[o.col] as string | number | boolean, bv = b[o.col] as string | number | boolean; return (av < bv ? -1 : av > bv ? 1 : 0) * (o.asc ? 1 : -1); });
      if (limit !== null) out = out.slice(0, limit);
      return out;
    };
    const respond = (data: Row[]) => {
      if (single) return data.length === 1 ? json(200, this.project(data[0], select)) : json(406, noRow);
      return json(200, data.map(r => this.project(r, select)));
    };

    if (method === 'GET') return respond(matched());
    if (method === 'POST') {
      const payload = JSON.parse(request.postData() || '[]');
      const items: Row[] = Array.isArray(payload) ? payload : [payload];
      if (!user) return json(401, { code: '42501', message: 'permission denied', details: null, hint: null });
      for (const r of items) {
        if (r.user_id !== user.id) return json(403, rls);
        if (name === 'messages' && !this.tables.conversations.some(c => c.id === r.conversation_id && c.user_id === user.id)) return json(403, rls);
        if (name === 'files' && String(r.storage_path ?? '').split('/')[0] !== user.id) return json(403, rls);
        if (name === 'file_chunks' && !this.tables.files.some(f => f.id === r.file_id && f.user_id === user.id)) return json(403, rls);
      }
      const now = this.now();
      const inserted = items.map(r => ({ id: crypto.randomUUID(), created_at: now, updated_at: now, archived: false, ...r }));
      rows.push(...inserted);
      if (!wantsRows) return route.fulfill({ status: 201, body: '' });
      return single ? json(201, this.project(inserted[0], select)) : json(201, inserted.map(r => this.project(r, select)));
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(request.postData() || '{}');
      const hit = matched();
      const now = this.now();
      for (const r of hit) Object.assign(r, patch, { updated_at: now });
      if (!wantsRows) return route.fulfill({ status: 204, body: '' });
      return respond(hit);
    }
    if (method === 'DELETE') {
      const hit = new Set(matched());
      this.tables[name] = rows.filter(r => !hit.has(r));
      this.cascade(name, [...hit]);
      if (!wantsRows) return route.fulfill({ status: 204, body: '' });
      return respond([...hit]);
    }
    return json(405, { message: 'method not allowed' });
  }

  private cascade(table: string, removed: Row[]) {
    const ids = new Set(removed.map(r => r.id));
    if (table === 'conversations') {
      this.tables.messages = this.tables.messages.filter(m => !ids.has(m.conversation_id));
      for (const f of this.tables.files) if (ids.has(f.conversation_id)) f.conversation_id = null;
    }
    if (table === 'files') this.tables.file_chunks = this.tables.file_chunks.filter(c => !ids.has(c.file_id));
    if (table === 'projects') {
      for (const c of this.tables.conversations) if (ids.has(c.project_id)) c.project_id = null;
      for (const f of this.tables.files) if (ids.has(f.project_id)) f.project_id = null;
    }
  }

  private async rpc(name: string, args: Row, user: { id: string } | null, json: (s: number, b: unknown) => Promise<void>) {
    if (!user) return json(401, { code: '42501', message: 'permission denied', details: null, hint: null });
    const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
    if (name === 'match_file_chunks') {
      const words = ((args.p_words as string[]) ?? []).map(w => w.toLowerCase());
      const fileIds = new Set((args.p_file_ids as string[]) ?? []);
      const ready = new Map(this.tables.files.filter(f => f.user_id === user.id && f.status === 'ready' && fileIds.has(f.id as string)).map(f => [f.id as string, f]));
      const out = this.tables.file_chunks
        .filter(c => c.user_id === user.id && ready.has(c.file_id as string))
        .map(c => { const t = tokens(String(c.content)); const rank = words.reduce((n, w) => n + t.filter(x => x === w || x.startsWith(w)).length, 0); return { file_id: c.file_id, file_name: ready.get(c.file_id as string)!.name, chunk_index: c.chunk_index, content: c.content, rank }; })
        .filter(c => c.rank > 0)
        .sort((a, b) => b.rank - a.rank || (a.chunk_index as number) - (b.chunk_index as number))
        .slice(0, Math.min(Number(args.p_limit ?? 24), 50));
      return json(200, out);
    }
    if (name === 'search_all') {
      const q = String(args.p_query ?? '').trim().toLowerCase();
      const out: Row[] = [];
      for (const c of this.tables.conversations) if (c.user_id === user.id && String(c.title).toLowerCase().includes(q)) out.push({ kind: 'conversation', id: c.id, title: c.title, snippet: null, conversation_id: c.id, project_id: c.project_id ?? null, updated_at: c.updated_at, rank: 1 });
      return json(200, out.slice(0, Number(args.p_limit ?? 30)));
    }
    return json(404, { code: '42883', message: `function ${name} does not exist`, details: null, hint: null });
  }

  // ── Storage (single request) ───────────────────────────────────────────────

  private ownsPath(path: string, user: { id: string } | null) { return Boolean(user) && path.split('/')[0] === user!.id; }

  private async storageHandle(route: MockRoute, url: URL, method: string, json: (s: number, b: unknown) => Promise<void>) {
    const request = route.request();
    const user = this.userFrom(request);
    const rest = url.pathname.slice('/storage/v1/'.length);
    const forbidden = () => json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });

    if (rest.startsWith('object/sign/')) {
      const [bucket, ...parts] = rest.slice('object/sign/'.length).split('/');
      const path = decodeURIComponent(parts.join('/'));
      if (!this.storage.has(path) || !this.ownsPath(path, user)) return json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return json(200, { signedURL: `/object/sign/${bucket}/${path}?token=signed` });
    }
    if (rest.startsWith('object/')) {
      const [bucket, ...parts] = rest.slice('object/'.length).split('/');
      const path = decodeURIComponent(parts.join('/'));
      if (method === 'POST' && parts.length) {
        if (!this.ownsPath(path, user)) return forbidden();
        if (this.storage.has(path) && request.headers()['x-upsert'] !== 'true') return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        const buf = request.postDataBuffer() ?? Buffer.alloc(0);
        // storage-js sends multipart/form-data for Blobs; keep the raw part body — the
        // tests only assert on size and on the object existing.
        const ct = request.headers()['content-type'] ?? '';
        const bytes = ct.startsWith('multipart/form-data') ? extractMultipartFile(buf, ct) : buf;
        this.storage.set(path, { bucket, bytes, contentType: bytes === buf ? ct : 'application/octet-stream' });
        return json(200, { Key: `${bucket}/${path}`, Id: crypto.randomUUID() });
      }
      if (method === 'GET' && parts.length) {
        const obj = this.storage.get(path);
        if (!obj || !this.ownsPath(path, user)) return json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        return route.fulfill({ status: 200, headers: { 'content-type': obj.contentType }, body: obj.bytes });
      }
      if (method === 'DELETE' && !parts.length) {
        const { prefixes } = JSON.parse(request.postData() || '{"prefixes":[]}') as { prefixes: string[] };
        const removed: Row[] = [];
        for (const p of prefixes) if (this.storage.has(p) && this.ownsPath(p, user)) { this.storage.delete(p); removed.push({ name: p, bucket_id: bucket }); }
        return json(200, removed);
      }
    }
    return json(404, { statusCode: '404', error: 'not_found', message: `no storage mock for ${method} ${rest}` });
  }

  // ── Storage (TUS resumable) ────────────────────────────────────────────────

  private async tusHandle(route: MockRoute, url: URL, method: string) {
    const request = route.request();
    const headers = request.headers();
    const user = this.userFrom(request);
    const tusHeaders = { 'tus-resumable': '1.0.0', 'access-control-expose-headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable' };
    const fail = (status: number, message: string) => route.fulfill({ status, headers: { ...tusHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ statusCode: String(status), error: 'tus', message }) });
    // Real Storage rejects anonymous / query-string credentials: only headers count.
    if (!user) return fail(401, 'Unauthorized');
    if (url.searchParams.has('token') || url.searchParams.has('apikey')) return fail(400, 'credentials must be sent in headers');

    if (method === 'POST' && url.pathname === '/storage/v1/upload/resumable') {
      const meta: Record<string, string> = {};
      for (const pair of (headers['upload-metadata'] ?? '').split(',')) {
        const [k, v] = pair.trim().split(' ');
        if (k) meta[k] = v ? Buffer.from(v, 'base64').toString('utf8') : '';
      }
      const path = meta.objectName ?? '';
      if (!this.ownsPath(path, user)) return fail(403, 'new row violates row-level security policy');
      if (this.storage.has(path) && headers['x-upsert'] !== 'true') return fail(409, 'The resource already exists');
      const id = crypto.randomUUID();
      this.tus.set(id, { bucket: meta.bucketName ?? 'knowledge', path, contentType: meta.contentType ?? 'application/octet-stream', length: Number(headers['upload-length'] ?? 0), received: [], offset: 0 });
      // Relative, as the TUS spec allows: tus-js-client resolves it against the endpoint, so the same mock works on any origin.
      return route.fulfill({ status: 201, headers: { ...tusHeaders, location: `/storage/v1/upload/resumable/${id}` }, body: '' });
    }
    const id = url.pathname.slice('/storage/v1/upload/resumable/'.length);
    const up = this.tus.get(id);
    if (!up) return fail(404, 'upload not found');
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...tusHeaders, 'upload-offset': String(up.offset), 'upload-length': String(up.length), 'cache-control': 'no-store' }, body: '' });
    if (method === 'PATCH') {
      if (Number(headers['upload-offset']) !== up.offset) return fail(409, 'offset mismatch');
      if (this.opts.tusPatchDelayMs) await new Promise(r => setTimeout(r, this.opts.tusPatchDelayMs));
      if (!this.tus.has(id)) return fail(404, 'upload terminated');
      const chunk = request.postDataBuffer() ?? Buffer.alloc(0);
      up.received.push(chunk);
      up.offset += chunk.length;
      if (up.offset >= up.length) {
        this.storage.set(up.path, { bucket: up.bucket, bytes: Buffer.concat(up.received), contentType: up.contentType });
        this.tus.delete(id);
      }
      return route.fulfill({ status: 204, headers: { ...tusHeaders, 'upload-offset': String(up.offset) }, body: '' });
    }
    if (method === 'DELETE') { this.tus.delete(id); return route.fulfill({ status: 204, headers: tusHeaders, body: '' }); }
    return fail(405, 'method not allowed');
  }

  // ── Chat Edge Function ─────────────────────────────────────────────────────

  private async chatHandle(route: MockRoute, method: string, json: (s: number, b: unknown) => Promise<void>) {
    const request = route.request();
    if (method === 'GET') return json(200, { models: [{ id: 'gpt-oss-120b', name: 'GPT OSS 120B', provider: 'groq', category: 'conversation', speed: 5, quality: 4, cost: 1, free: true, context_length: 131072, supports_vision: false, supports_tools: true }] });
    if (!this.userFrom(request)) return json(401, { error: 'Unauthorized', code: 'unauthorized', request_id: 'e2e' });
    if (this.chat.failNextWith) { const f = this.chat.failNextWith; this.chat.failNextWith = undefined; return json(f.status, { error: f.error, code: f.code, request_id: 'e2e' }); }
    const body = JSON.parse(request.postData() || '{}');
    const text = this.chat.reply ? this.chat.reply(body) : `Echo: ${[...body.messages].reverse().find((m: { role: string }) => m.role === 'user')?.content ?? ''}`;
    // Playwright cannot stream a fulfilled body incrementally; pace the whole
    // response instead so "generating" state is still observable on long replies.
    const words = text.split(' ');
    await new Promise(r => setTimeout(r, Math.min(words.length, 40) * (this.chat.wordDelayMs ?? 15)));
    const frames = words.map((w, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + w } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-model-used': 'gpt-oss-120b', 'x-model-name': 'GPT OSS 120B', 'x-route-category': 'conversation', 'access-control-expose-headers': 'X-Model-Used, X-Model-Name, X-Route-Category' }, body: frames });
  }
}

/** Pull the file part out of a multipart/form-data body (storage-js upload). */
function extractMultipartFile(buf: Buffer, contentType: string): Buffer {
  const m = /boundary=(.+)$/.exec(contentType);
  if (!m) return buf;
  const boundary = Buffer.from(`--${m[1]}`);
  let start = 0;
  let best: Buffer | null = null;
  while (true) {
    const b = buf.indexOf(boundary, start);
    if (b === -1) break;
    const headerEnd = buf.indexOf('\r\n\r\n', b);
    if (headerEnd === -1) break;
    const next = buf.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const headers = buf.subarray(b, headerEnd).toString('utf8');
    const part = buf.subarray(headerEnd + 4, next - 2); // strip trailing \r\n
    if (/filename=/.test(headers) || best === null) best = part;
    start = next;
  }
  return best ?? buf;
}

export const seedConversation = (id: string, title: string, updated_at: string, extra: Row = {}): Row =>
  ({ id, title, pinned: false, archived: false, project_id: null, created_at: updated_at, updated_at, ...extra });
export const seedMessage = (id: string, conversation_id: string, content: string, created_at: string, role: 'user' | 'assistant' = 'user'): Row =>
  ({ id, conversation_id, role, content, created_at, model: role === 'assistant' ? 'gpt-oss-120b' : null, model_name: role === 'assistant' ? 'GPT OSS 120B' : null, attachments: null, sources: null });
