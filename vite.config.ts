import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// E2E_CSP=1: serve the production CSP (from vercel.json) as an *enforced* header on
// `vite preview`, so the e2e suite proves nothing the app needs is blocked.
function e2eCspHeaders(): Record<string, string> | undefined {
  if (!process.env.E2E_CSP) return undefined;
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const raw = vercel.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy')?.value
    ?? vercel.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy-Report-Only').value;
  const mockHost = new URL(process.env.VITE_SUPABASE_URL ?? 'https://e2e-mock.supabase.co').host;
  const value = raw.replace(/vqbzyutqgjbfdwxjkplq\.supabase\.co/g, mockHost).replace(/; report-uri[^;]*/, '').replace(/; report-to[^;]*/, '');
  return { 'Content-Security-Policy': value };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    host: true,
  },
  preview: { headers: e2eCspHeaders() },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
});
