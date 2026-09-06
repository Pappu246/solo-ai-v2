/**
 * Serves `MockBackend` over plain HTTP so the app can be *used* against it —
 * not just tested. `npm run demo` starts this on :8787 and a Vite dev server
 * whose `VITE_SUPABASE_URL` points at it (same-origin via the Vite proxy), so
 * you can click through every flow without a Supabase project, keys or network.
 *
 * Exactly the same request handling as the Playwright suite uses; only the
 * transport differs (Node `http` instead of `page.route`). Data lives in memory
 * and resets when the process restarts.
 *
 *   node --experimental-strip-types e2e/support/mockServer.ts [--port 8787]
 */
import http from 'node:http';
import { MockBackend, USER, PASSWORD, seedConversation, seedMessage, type MockRequest, type MockRoute } from './mockBackend.ts';

const args = process.argv.slice(2);
const PORT = Number(process.env.MOCK_PORT ?? args[args.indexOf('--port') + 1] ?? 8787) || 8787;
const HOST = process.env.MOCK_HOST ?? '127.0.0.1';
/** Path prefix the app addresses the backend under (Vite proxies `/mock/*` here). */
const PREFIX = process.env.MOCK_PREFIX ?? '/mock';

const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

export const backend = new MockBackend({
  clockStart: Date.now(),
  conversations: [
    seedConversation('11111111-aaaa-4aaa-8aaa-000000000001', 'Trip planning for Kyoto', ago(1), { pinned: true }),
    seedConversation('11111111-aaaa-4aaa-8aaa-000000000002', 'Refactor the upload pipeline', ago(2)),
    seedConversation('11111111-aaaa-4aaa-8aaa-000000000003', 'Weekly status email', ago(4)),
    seedConversation('11111111-aaaa-4aaa-8aaa-000000000004', 'Old brainstorm (archived)', ago(30), { archived: true }),
  ],
  messages: [
    seedMessage('22222222-bbbb-4bbb-8bbb-000000000001', '11111111-aaaa-4aaa-8aaa-000000000001', 'Plan a 3-day trip to Kyoto in autumn.', ago(1)),
    seedMessage('22222222-bbbb-4bbb-8bbb-000000000002', '11111111-aaaa-4aaa-8aaa-000000000001', 'Day 1: Fushimi Inari at sunrise, then Tofuku-ji for the maples. Day 2: Arashiyama bamboo grove and Tenryu-ji. Day 3: Kiyomizu-dera, Gion at dusk.', ago(1), 'assistant'),
    seedMessage('22222222-bbbb-4bbb-8bbb-000000000003', '11111111-aaaa-4aaa-8aaa-000000000002', 'How should I split a 200 MB upload into resumable chunks?', ago(2)),
    seedMessage('22222222-bbbb-4bbb-8bbb-000000000004', '11111111-aaaa-4aaa-8aaa-000000000002', 'Use TUS: create the upload once, then PATCH fixed-size chunks (6 MiB works well) and resume from the server-reported offset after any interruption.', ago(2), 'assistant'),
    seedMessage('22222222-bbbb-4bbb-8bbb-000000000005', '11111111-aaaa-4aaa-8aaa-000000000003', 'Draft a short status update for the team.', ago(4)),
    seedMessage('22222222-bbbb-4bbb-8bbb-000000000006', '11111111-aaaa-4aaa-8aaa-000000000003', 'Hi team — quick update: uploads are now resumable, conversation actions stay in sync after refresh, and the E2E suite is green. Next: final review.', ago(4), 'assistant'),
  ],
  chat: {
    wordDelayMs: 25,
    reply: ({ messages, context }) => {
      const last = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
      const knowledge = (context?.knowledge as Array<{ file_name: string; content: string }> | undefined) ?? [];
      const files = knowledge.length ? ` I also read ${knowledge.length} excerpt(s) from ${[...new Set(knowledge.map(k => k.file_name))].join(', ')}: “${knowledge[0].content.slice(0, 160).replace(/\s+/g, ' ')}…”.` : '';
      return `This is the offline demo model, so I can't really think — but every other part of the app is real. You said: “${last.slice(0, 200)}”.${files} Try renaming, pinning, archiving or deleting this chat, attach a large file to watch the resumable upload, or press Stop while I'm typing.`;
    },
  },
});

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Adapt one Node request/response pair to the `MockRoute` the backend understands.
 * `origin` is the public base the app addresses (e.g. `http://host:5173/mock`); the
 * backend itself only looks at the Supabase-shaped path after that prefix.
 */
function adapt(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, origin: string): MockRoute {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v ?? '');
  const path = (req.url ?? '/').startsWith(PREFIX) ? (req.url ?? '/').slice(PREFIX.length) : (req.url ?? '/');
  const request: MockRequest = {
    method: () => req.method ?? 'GET',
    // Any origin works here — the backend routes on pathname + search only.
    url: () => `http://mock.local${path}`,
    headers: () => headers,
    postData: () => (body.length ? body.toString('utf8') : null),
    postDataBuffer: () => (body.length ? body : null),
  };
  return {
    request: () => request,
    async fulfill(response) {
      const out: Record<string, string> = {
        'access-control-allow-origin': headers['origin'] ?? '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': headers['access-control-request-headers'] ?? '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
        'access-control-expose-headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable, Content-Range, X-Model-Used, X-Model-Name, X-Route-Category',
        ...(response.headers ?? {}),
      };
      // The backend hands out spec-style relative TUS Locations; make them absolute for the proxy origin.
      if (out.location && out.location.startsWith('/')) out.location = origin + out.location;
      const payload = response.body ?? '';
      const isSse = out['content-type']?.startsWith('text/event-stream');
      res.writeHead(response.status ?? 200, out);
      if (isSse && typeof payload === 'string') {
        // Trickle SSE frames so the UI really streams (and Stop has something to interrupt).
        const frames = payload.split('\n\n').filter(Boolean);
        for (const frame of frames) {
          if (res.destroyed) return;
          res.write(frame + '\n\n');
          await new Promise(r => setTimeout(r, 25));
        }
        res.end();
        return;
      }
      res.end(payload);
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': (req.headers['access-control-request-headers'] as string | undefined) ?? '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '600',
      });
      return res.end();
    }
    if (req.url === '/healthz' || req.url === `${PREFIX}/healthz`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, conversations: backend.tables.conversations.length, files: backend.tables.files.length, storageObjects: backend.storage.size, requests: backend.log.length }));
    }
    const body = await readBody(req);
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? `${HOST}:${PORT}`;
    const origin = `${proto}://${host}${PREFIX}`;
    await backend.handle(adapt(req, res, body, origin));
  } catch (err) {
    console.error('[mockServer]', req.method, req.url, err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mock Supabase listening on http://${HOST}:${PORT}${PREFIX}  (sign in as ${USER.email} / "${PASSWORD}", or create an account)`);
});
