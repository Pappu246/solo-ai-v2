/**
 * `npm run demo` — run Solo AI fully offline.
 *
 * Starts the in-memory mock Supabase (`mockServer.ts`) and a Vite dev server
 * configured by `vite.demo.config.ts`, which proxies `/mock/*` to it. Sign in
 * with the seeded account or create one; everything lives in memory.
 *
 *   PORT=5173 MOCK_PORT=8787 npm run demo
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = process.env.PORT ?? '5173';
const MOCK_PORT = process.env.MOCK_PORT ?? '8787';

const env = { ...process.env, PORT, MOCK_PORT, MOCK_HOST: '127.0.0.1' };
const children = [
  spawn(process.execPath, ['--experimental-strip-types', path.join(root, 'e2e/support/mockServer.ts')], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--config', 'vite.demo.config.ts'], { cwd: root, env, stdio: 'inherit' }),
];

const stop = () => { for (const c of children) if (!c.killed) c.kill('SIGTERM'); };
for (const c of children) c.on('exit', code => { stop(); process.exitCode = code ?? 0; });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
