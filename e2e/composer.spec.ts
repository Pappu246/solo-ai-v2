/**
 * Composer: keyboard send (Enter / Shift+Enter / Ctrl+Enter mode), the Send
 * button, Stop mid-stream, and the auto-title + sidebar placement of a new
 * chat. The mocked chat function streams SSE frames like the real one.
 */
import { test, expect } from './support/fixtures';
import { seedConversation } from './support/mockBackend';

test.describe('composer', () => {
  test('Enter sends, Shift+Enter inserts a newline, and the reply streams into a new chat', async ({ app, backend }) => {
    await app.open();
    await expect(app.sendButton).toBeDisabled();

    await app.composer.fill('First line');
    await app.composer.press('Shift+Enter');
    await app.composer.type('second line');
    await expect(app.composer).toHaveValue('First line\nsecond line');
    expect(backend.tables.messages).toHaveLength(0);

    await app.composer.press('Enter');
    await expect(app.message('Echo: First line')).toBeVisible();
    await expect(app.composer).toHaveValue('');
    await expect(app.header).toHaveText('First line second line');
    await expect(app.row('First line second line')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => backend.tables.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(backend.tables.conversations).toHaveLength(1);
    // The chat request carried the user's token in a header, never in the URL.
    const post = backend.log.find(r => r.method === 'POST' && r.url.startsWith('/functions/v1/chat'))!;
    expect(post.headers['authorization']).toMatch(/^Bearer /);
    expect(post.url).not.toMatch(/token=|apikey=/);
  });

  test('the Send button works, is disabled while empty, and the composer is labelled', async ({ app, page }) => {
    await app.open();
    await expect(app.composer).toHaveAttribute('aria-label', 'Message');
    await expect(app.sendButton).toBeDisabled();
    await app.composer.fill('Click to send');
    await expect(app.sendButton).toBeEnabled();
    await app.sendButton.click();
    await expect(app.message('Echo: Click to send')).toBeVisible();
    await expect(page.getByRole('main').locator('[data-role="user"]')).toHaveCount(1);
  });

  test('Stop interrupts generation via button and Escape, keeping the partial reply', async ({ app, page, backend }) => {
    backend.setChat({ reply: () => Array.from({ length: 400 }, (_, i) => `word${i}`).join(' '), wordDelayMs: 40 });
    await app.open();
    await app.send('long one');
    await expect(app.stopButton).toBeVisible();
    await app.stopButton.click();
    await expect(app.sendButton).toBeVisible();
    // Whatever arrived (possibly nothing) is kept; no crash, no duplicate user turn.
    await expect(page.getByRole('main').locator('[data-role="user"]')).toHaveCount(1);
    await expect.poll(() => backend.tables.messages.filter(m => m.role === 'user')).toHaveLength(1);

    await app.send('again');
    await expect(app.stopButton).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(app.sendButton).toBeVisible();
    await expect(page.getByRole('main').locator('[data-role="user"]')).toHaveCount(2);
  });

  test('Ctrl+Enter mode: Enter adds a newline and Ctrl+Enter sends', async ({ app, page }) => {
    await app.open();
    await page.getByRole('button', { name: /settings/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const toggle = dialog.getByRole('switch', { name: 'Send with Enter' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await app.composer.fill('line one');
    await app.composer.press('Enter');
    await expect(app.composer).toHaveValue('line one\n');
    await app.composer.press('Control+Enter');
    await expect(app.message('Echo: line one')).toBeVisible();
  });

  test('a new chat is still there after a reload', async ({ app, page }) => {
    await app.open();
    await app.send('hello');
    await expect(app.message('Echo: hello')).toBeVisible();
    await page.reload();
    await expect(app.row('hello')).toBeVisible();
  });
});

test.describe('composer with existing pinned chat', () => {
  test.use({ backendOptions: { conversations: [seedConversation('p1', 'Pinned one', '2026-01-01T00:00:00.000Z', { pinned: true })] } });

  test('new chats sit below the pinned section immediately and after reload', async ({ app, page }) => {
    await app.open();
    await app.send('fresh');
    await expect(app.message('Echo: fresh')).toBeVisible();
    const rows = app.chats.getByRole('button', { name: /^(Pinned )?(Pinned one|fresh)$/ });
    await expect(rows).toHaveText([/Pinned one/, /fresh/]);
    await page.reload();
    await expect(rows).toHaveText([/Pinned one/, /fresh/]);
  });
});
