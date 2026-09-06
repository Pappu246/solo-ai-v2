/**
 * Full upload flow: attach a document in the composer → it is uploaded,
 * indexed and attached → a question about it reaches the chat function with
 * the relevant excerpt as context → the answer shows the file as a source.
 * Also: a large file takes the resumable (TUS) path with header-only
 * credentials, and cancelling mid-upload terminates it and leaves nothing
 * behind.
 */
import { test, expect } from './support/fixtures';

const PLAN = `# Launch plan

The Falcon rollout starts on 14 October and the pricing is 12 dollars per seat.
Support hours are 9 to 5 on weekdays. Marketing owns the announcement.
`;

test.describe('upload → ask', () => {
  test('a small document is uploaded in one request, indexed, and used to answer a question', async ({ app, page, backend }) => {
    backend.setChat({
      reply: ({ context }) => {
        const knowledge = (context?.knowledge as Array<{ file_name: string; content: string }> | undefined) ?? [];
        return knowledge.length ? `From ${knowledge[0].file_name}: ${/12 dollars per seat/.test(knowledge[0].content) ? 'pricing is 12 dollars per seat' : 'no pricing found'}` : 'I have no file context';
      },
    });
    await app.open();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files' }).click();
    await (await chooser).setFiles({ name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from(PLAN) });

    // Chip goes uploading → processing → ready (size label) and the file row exists in the database.
    const chip = page.locator('[data-file-status]', { hasText: 'plan.md' });
    await expect(chip).toHaveAttribute('data-file-status', 'ready');
    await expect.poll(() => backend.tables.files[0]?.status).toBe('ready');
    expect(backend.tables.file_chunks.length).toBeGreaterThan(0);
    expect(backend.storage.has(String(backend.tables.files[0].storage_path))).toBe(true);
    // Small → single-request upload (no TUS session), credentials in headers only.
    const upload = backend.log.find(r => r.method === 'POST' && r.url.startsWith('/storage/v1/object/knowledge/'))!;
    expect(upload).toBeTruthy();
    expect(upload.headers['authorization']).toMatch(/^Bearer /);
    expect(upload.headers['x-upsert']).toBe('false');
    expect(backend.log.some(r => r.url.startsWith('/storage/v1/upload/resumable'))).toBe(false);

    await app.send('What is the pricing per seat?');
    await expect(app.message('From plan.md: pricing is 12 dollars per seat')).toBeVisible();
    await expect(page.getByLabel('Sources').getByText('plan.md')).toBeVisible();
    // The file is now linked to the chat that was created by sending.
    await expect.poll(() => backend.tables.files[0]?.conversation_id).toBe(backend.tables.conversations[0]?.id);
  });
});

test.describe('resumable uploads', () => {
  test.use({ backendOptions: { tusPatchDelayMs: 600 } });

  test('a large file goes through TUS in chunks with header credentials, shows progress and becomes ready', async ({ app, page, backend }) => {
    await app.open();
    const size = 6 * 1024 * 1024 + 4096; // just past the resumable threshold → 2 PATCH chunks
    const buffer = Buffer.alloc(size, 'a');
    buffer.write('Big log file starts here. The secret word is pelican.\n', 0);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files' }).click();
    await (await chooser).setFiles({ name: 'big.log', mimeType: 'text/plain', buffer });

    const chip = page.locator('[data-file-status]', { hasText: 'big.log' });
    // Byte progress is exposed as a progressbar + "NN%" label while uploading
    // (the bar is zero-width at 0%, so assert on presence and label, not paint).
    const bar = chip.getByRole('progressbar', { name: 'Uploading big.log' });
    await expect(bar).toBeAttached();
    await expect(chip).toHaveText(/\d+%/);
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(chip).toHaveAttribute('data-file-status', 'ready', { timeout: 30_000 });

    const create = backend.log.find(r => r.method === 'POST' && r.url === '/storage/v1/upload/resumable')!;
    expect(create.headers['authorization']).toMatch(/^Bearer /);
    expect(create.headers['apikey']).toBeTruthy();
    expect(create.headers['x-upsert']).toBe('false');
    expect(create.headers['upload-length']).toBe(String(size));
    const patches = backend.log.filter(r => r.method === 'PATCH' && r.url.startsWith('/storage/v1/upload/resumable/'));
    expect(patches.length).toBe(2);
    for (const r of backend.log.filter(x => x.url.startsWith('/storage/v1/upload/resumable'))) expect(r.url).not.toMatch(/token=|apikey=/);
    const stored = backend.storage.get(String(backend.tables.files[0].storage_path))!;
    expect(stored.bytes.length).toBe(size);
    expect(backend.tables.files[0].status).toBe('ready');
  });

  test('cancelling mid-upload terminates the TUS session and removes the row and the chip', async ({ app, page, backend }) => {
    await app.open();
    const size = 6 * 1024 * 1024 * 3 + 100; // 4 chunks → plenty of time to cancel
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files' }).click();
    await (await chooser).setFiles({ name: 'huge.txt', mimeType: 'text/plain', buffer: Buffer.alloc(size, 'z') });

    const chip = page.locator('[data-file-status]', { hasText: 'huge.txt' });
    await expect(chip).toHaveAttribute('data-file-status', 'uploading');
    await expect.poll(() => backend.tables.files.length).toBe(1);
    await chip.getByRole('button', { name: 'Cancel upload of huge.txt' }).click();

    await expect(chip).toHaveCount(0);
    await expect(app.toast('Upload cancelled')).toBeVisible();
    await expect.poll(() => backend.tables.files.length).toBe(0);
    await expect.poll(() => backend.log.some(r => r.method === 'DELETE' && r.url.startsWith('/storage/v1/upload/resumable/'))).toBe(true);
    expect(backend.tus.size).toBe(0);
    expect(backend.storage.size).toBe(0);
    // The composer is still usable afterwards.
    await app.send('still here?');
    await expect(app.message('Echo: still here?')).toBeVisible();
  });
});
