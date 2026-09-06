import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * Offline demo: the app talks to the in-memory mock Supabase from
 * `e2e/support/mockServer.ts` through a same-origin proxy (`/mock/*`), so the
 * preview works from any host (including tunnelled/iframe previews) with no
 * project, keys or network. Start both with `npm run demo`.
 *
 * supabase-js insists on an absolute http(s) URL and the page origin is only
 * known in the browser, so the two `VITE_SUPABASE_*` reads are replaced with
 * expressions evaluated at runtime instead of build-time constants.
 */
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8787);

export default mergeConfig(
  base,
  defineConfig({
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '(globalThis.location ? globalThis.location.origin + "/mock" : "http://127.0.0.1:8787/mock")',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_offline_demo'),
    },
    server: {
      host: '0.0.0.0',
      port: Number(process.env.PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/mock': { target: `http://127.0.0.1:${MOCK_PORT}`, changeOrigin: false },
      },
    },
  }),
);
