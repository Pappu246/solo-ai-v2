/** Real PDF extraction against the production build; only Supabase is mocked. */
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { buildPdf } from './support/pdfFixture';
import type { MockBackend } from './support/mockBackend';

const PDF_TEXT = 'The Falcon PDF rollout starts on 14 October. Pricing is 12 dollars per seat.';
// ?url emits the untouched .mjs asset; ?worker emits a Vite-built .js chunk.
const STANDALONE_WORKER = /\/pdf\.worker(?:\.min)?-[^/?]+\.mjs(?:\?.*)?$/;
const BUNDLED_WORKER = /\/pdf\.worker(?:\.min)?-[^/?]+\.js(?:\?.*)?$/;

async function attachPdfs(page: Page, files: Array<{ name: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles(files.map(file => ({ ...file, mimeType: 'application/pdf' })));
}

async function expectIndexed(page: Page, backend: MockBackend, name: string, buffer: Buffer, text = PDF_TEXT) {
  const chip = page.locator('[data-file-status]', { hasText: name });
  await expect(chip).toHaveAttribute('data-file-status', 'ready', { timeout: 20_000 });
  const row = backend.tables.files.find(file => file.name === name)!;
  expect(row).toMatchObject({ status: 'ready', error: null, size: buffer.length, metadata: { pages: 1, uploaded: true } });
  expect(row.char_count).toBeGreaterThan(0);
  expect(row.chunk_count).toBeGreaterThan(0);
  expect(backend.tables.file_chunks.filter(chunk => chunk.file_id === row.id).map(chunk => chunk.content).join('\n')).toContain(text);
  expect(backend.storage.get(String(row.storage_path))?.bytes.equals(buffer)).toBe(true);
}

/** A real CSP restriction: scripts can load, but no dedicated Worker can run. */
async function disableWorkers(page: Page) {
  await page.route('/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "worker-src 'none'" } });
  });
}

test.describe('PDF uploads', () => {
  test('a small real PDF uses one storage request, extracts text, and answers with a source', async ({ app, page, backend }) => {
    backend.setChat({
      reply: ({ context }) => {
        const knowledge = (context?.knowledge as Array<{ content: string }> | undefined) ?? [];
        return knowledge.some(chunk => chunk.content.includes(PDF_TEXT)) ? 'PDF pricing is 12 dollars per seat.' : 'No PDF context found.';
      },
    });
    await app.open();
    const buffer = buildPdf(PDF_TEXT);
    await attachPdfs(page, [{ name: 'small.pdf', buffer }]);
    await expectIndexed(page, backend, 'small.pdf', buffer);

    expect(backend.log.filter(r => r.method === 'POST' && r.url.startsWith('/storage/v1/object/knowledge/'))).toHaveLength(1);
    expect(backend.log.some(r => r.url.startsWith('/storage/v1/upload/resumable'))).toBe(false);
    await app.send('What is the PDF pricing per seat?');
    await expect(app.message('PDF pricing is 12 dollars per seat.')).toBeVisible();
    await expect(page.getByLabel('Sources').getByText('small.pdf')).toBeVisible();
  });

  test('a 7 MB real PDF uses TUS and still extracts and indexes its text', async ({ app, page, backend }) => {
    await app.open();
    const buffer = buildPdf(PDF_TEXT, 7 * 1024 * 1024);
    expect(buffer.length).toBe(7 * 1024 * 1024);
    await attachPdfs(page, [{ name: 'large.pdf', buffer }]);
    await expectIndexed(page, backend, 'large.pdf', buffer);

    const creates = backend.log.filter(r => r.method === 'POST' && r.url === '/storage/v1/upload/resumable');
    expect(creates).toHaveLength(1);
    expect(creates[0].headers['upload-length']).toBe(String(buffer.length));
    expect(backend.log.filter(r => r.method === 'PATCH' && r.url.startsWith('/storage/v1/upload/resumable/'))).toHaveLength(2);
    expect(backend.log.some(r => r.method === 'POST' && r.url.startsWith('/storage/v1/object/knowledge/'))).toBe(false);
  });

  test('the bundled worker extracts when the standalone .mjs worker asset is blocked', async ({ app, page, backend }) => {
    const standaloneRequests: string[] = [];
    const workerUrls: string[] = [];
    await page.route(STANDALONE_WORKER, route => {
      standaloneRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    page.on('worker', worker => workerUrls.push(worker.url()));
    await app.open();
    const buffer = buildPdf(PDF_TEXT);
    await attachPdfs(page, [{ name: 'blocked-asset.pdf', buffer }]);
    await expectIndexed(page, backend, 'blocked-asset.pdf', buffer);

    expect(workerUrls.filter(url => BUNDLED_WORKER.test(url))).toHaveLength(1);
    expect(standaloneRequests).toEqual([]); // No hidden URL-based fake-worker fallback.
  });

  test('concurrent and later PDFs reuse the bundled worker without destroying each other', async ({ app, page, backend }) => {
    const workerUrls: string[] = [];
    page.on('worker', worker => workerUrls.push(worker.url()));
    await app.open();
    const files = ['first.pdf', 'second.pdf'].map(name => ({ name, buffer: buildPdf(`Text for ${name}`) }));
    await attachPdfs(page, files);
    await Promise.all(files.map(file => expectIndexed(page, backend, file.name, file.buffer, `Text for ${file.name}`)));

    const later = buildPdf(PDF_TEXT);
    await attachPdfs(page, [{ name: 'later.pdf', buffer: later }]);
    await expectIndexed(page, backend, 'later.pdf', later);
    expect(workerUrls.filter(url => BUNDLED_WORKER.test(url))).toHaveLength(1);
  });

  test('CSP-disabled Workers use a single main-thread fallback for concurrent and later PDFs', async ({ app, page, backend }) => {
    await disableWorkers(page);
    const standaloneRequests: string[] = [];
    page.on('request', request => { if (STANDALONE_WORKER.test(request.url())) standaloneRequests.push(request.url()); });
    await app.open();
    const files = ['fallback-one.pdf', 'fallback-two.pdf'].map(name => ({ name, buffer: buildPdf(`Text for ${name}`) }));
    await attachPdfs(page, files);
    await Promise.all(files.map(file => expectIndexed(page, backend, file.name, file.buffer, `Text for ${file.name}`)));

    const later = buildPdf(PDF_TEXT);
    await attachPdfs(page, [{ name: 'fallback-later.pdf', buffer: later }]);
    await expectIndexed(page, backend, 'fallback-later.pdf', later);
    expect(standaloneRequests).toHaveLength(1);
  });

  test('a browser without Worker support can extract a real PDF on the main thread', async ({ app, page, backend }) => {
    await page.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }); });
    await app.open();
    const buffer = buildPdf(PDF_TEXT);
    await attachPdfs(page, [{ name: 'no-workers.pdf', buffer }]);
    await expectIndexed(page, backend, 'no-workers.pdf', buffer);
  });

  test('worker and fallback failures expose the original detail in the UI and console', async ({ app, page, backend }) => {
    await disableWorkers(page);
    await page.route(STANDALONE_WORKER, route => route.abort('blockedbyclient'));
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await app.open();
    await attachPdfs(page, [{ name: 'unavailable.pdf', buffer: buildPdf(PDF_TEXT) }]);

    const chip = page.locator('[data-file-status]', { hasText: 'unavailable.pdf' });
    await expect(chip).toHaveAttribute('data-file-status', 'failed');
    await expect(chip).toHaveAttribute('title', /PDF reader could not start/i);
    await expect(chip).toHaveAttribute('title', /Failed to fetch dynamically imported module/i);
    expect(backend.tables.files[0].error).toMatch(/worker.*fallback/i);
    expect(backend.tables.files[0].error).not.toMatch(/corrupted/i);
    expect(backend.tables.file_chunks).toHaveLength(0);
    expect(errors.some(message => message.includes('[PDF extraction]') && message.includes('Failed to fetch dynamically imported module'))).toBe(true);
  });
});
