/**
 * In-memory stand-in for the subset of the Supabase client used by the app.
 * Supports: auth.getSession/onAuthStateChange, and from(table).select/insert/update/delete
 * with eq/in/order/single chaining. Enough to exercise useChat end-to-end.
 */
import { vi } from 'vitest';

type Row = Record<string, unknown>;

export function createMockSupabase(opts: { userId?: string | null } = {}) {
  const tables: Record<string, Row[]> = { conversations: [], messages: [] };
  const user = opts.userId === null ? null : { id: opts.userId ?? 'user-1', email: 'test@example.com' };
  const session = user ? { access_token: 'token', user } : null;

  function query(table: string) {
    const rows = () => (tables[table] ||= []);
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let single = false;

    const apply = () => {
      let out = rows().filter(r => filters.every(f => f(r)));
      for (const o of [...orders].reverse()) {
        out = [...out].sort((a, b) => {
          const av = a[o.col] as string | number | boolean, bv = b[o.col] as string | number | boolean;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      return out;
    };

    const exec = async () => {
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const inserted = items.map(r => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), archived: false, ...r }));
        rows().push(...inserted);
        return { data: single ? inserted[0] : inserted, error: null };
      }
      if (op === 'update') {
        const matched = apply();
        for (const r of matched) Object.assign(r, payload);
        return { data: matched, error: null };
      }
      if (op === 'delete') {
        const matched = new Set(apply());
        tables[table] = rows().filter(r => !matched.has(r));
        return { data: null, error: null };
      }
      const data = apply();
      return { data: single ? data[0] ?? null : data, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return builder; },
      update: (p: Row) => { op = 'update'; payload = p; return builder; },
      delete: () => { op = 'delete'; return builder; },
      eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return builder; },
      in: (col: string, vals: unknown[]) => { filters.push(r => vals.includes(r[col])); return builder; },
      order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return builder; },
      single: () => { single = true; return builder; },
      maybeSingle: () => { single = true; return builder; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return builder;
  }

  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn((table: string) => query(table)),
  };
  return { client, tables, user };
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
}

/** Build a fetch mock for the chat Edge Function that streams the given text. */
export function mockChatFetch(reply: string, opts: MockFetchOptions = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method === 'GET') {
      return new Response(JSON.stringify({ models: opts.models ?? [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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
