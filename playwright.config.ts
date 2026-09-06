import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real Vite build against an in-browser mock of the
 * Supabase HTTP surface (see e2e/support/mockBackend.ts) — no project, keys
 * or network are needed. `VITE_*` values below only have to be *shaped* like
 * real ones so the app leaves its setup screen; every request to that origin
 * is intercepted with `page.route`.
 *
 * Local browsers: `npx playwright install chromium`. Environments that cannot
 * download browsers may point PLAYWRIGHT_CHROMIUM_PATH at an existing binary.
 */
const PORT = Number(process.env.E2E_PORT || 4173);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath
      ? { executablePath, args: (process.env.PLAYWRIGHT_CHROMIUM_ARGS || '--no-sandbox --disable-gpu --disable-dev-shm-usage').split(' ').filter(Boolean) }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build -- --mode e2e && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e-mock.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_mock_key',
    },
  },
});
