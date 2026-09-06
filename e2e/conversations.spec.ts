/**
 * Conversation actions end-to-end: rename, pin/unpin, archive/unarchive and
 * delete (cancel + confirm) — each persisted through the (mocked) REST API and
 * reflected in sidebar, header and open chat without a reload, and identical
 * after one.
 */
import { test, expect } from './support/fixtures';
import { seedConversation, seedMessage } from './support/mockBackend';

test.use({
  backendOptions: {
    conversations: [
      seedConversation('c1', 'Alpha chat', '2026-01-03T00:00:00.000Z'),
      seedConversation('c2', 'Beta chat', '2026-01-02T00:00:00.000Z'),
      seedConversation('c3', 'Gamma chat', '2026-01-01T00:00:00.000Z'),
    ],
    messages: [
      seedMessage('m1', 'c1', 'alpha question', '2026-01-03T00:00:00.000Z'),
      seedMessage('m2', 'c2', 'beta question', '2026-01-02T00:00:00.000Z'),
    ],
  },
});

test.describe('conversation actions', () => {
  test('rename keeps the chat open and updates header + sidebar + database; survives reload', async ({ app, page, backend }) => {
    await app.open();
    await app.openChat('Alpha chat');
    await expect(app.message('alpha question')).toBeVisible();

    await app.rename('Alpha chat', 'Alpha renamed');

    await expect(app.header).toHaveText('Alpha renamed');
    await expect(app.row('Alpha renamed')).toHaveAttribute('aria-current', 'page');
    await expect(app.message('alpha question')).toBeVisible();
    await expect.poll(() => backend.tables.conversations.find(c => c.id === 'c1')?.title).toBe('Alpha renamed');
    // The write went through PATCH with the updated row requested back (reconciliation).
    const patch = backend.log.find(r => r.method === 'PATCH' && r.url.startsWith('/rest/v1/conversations'));
    expect(patch?.url).toContain('id=eq.c1');
    expect(patch?.headers['prefer']).toContain('return=representation');

    await page.reload();
    await expect(app.row('Alpha renamed')).toBeVisible();
    await expect(app.chats.getByText('Alpha chat', { exact: true })).toHaveCount(0);
  });

  test('pin moves the chat into Pinned and keeps it selected; unpin moves it back', async ({ app, backend }) => {
    await app.open();
    await app.openChat('Gamma chat');

    await app.menuAction('Gamma chat', 'Pin');
    await expect(app.chats.getByText('Pinned', { exact: true })).toBeVisible();
    await expect(app.row('Gamma chat')).toHaveAttribute('aria-current', 'page');
    await expect(app.header).toHaveText('Gamma chat');
    await expect.poll(() => backend.tables.conversations.find(c => c.id === 'c3')?.pinned).toBe(true);
    // First row is now Gamma — the position a reload gives it.
    await expect(app.chats.getByRole('button', { name: /chat$/ }).first()).toHaveText(/Gamma chat/);

    await app.menuAction('Gamma chat', 'Unpin');
    await expect(app.chats.getByText('Pinned', { exact: true })).toHaveCount(0);
    await expect(app.row('Gamma chat')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => backend.tables.conversations.find(c => c.id === 'c3')?.pinned).toBe(false);
  });

  test('archiving the open chat opens its neighbour; unarchive restores it without stealing focus', async ({ app, backend }) => {
    await app.open();
    await app.openChat('Alpha chat');
    await expect(app.message('alpha question')).toBeVisible();

    await app.menuAction('Alpha chat', /^Archive$/);

    await expect(app.header).toHaveText('Beta chat');
    await expect(app.message('beta question')).toBeVisible();
    await expect(app.row('Beta chat')).toHaveAttribute('aria-current', 'page');
    await expect(app.toast('Chat archived')).toBeVisible();
    await expect.poll(() => backend.tables.conversations.find(c => c.id === 'c1')?.archived).toBe(true);

    await app.chats.getByRole('button', { name: /Archived \(1\)/ }).click();
    await expect(app.row('Alpha chat')).toBeVisible();
    await app.menuAction('Alpha chat', 'Unarchive');
    await expect.poll(() => backend.tables.conversations.find(c => c.id === 'c1')?.archived).toBe(false);
    await expect(app.header).toHaveText('Beta chat');
    await expect(app.chats.getByRole('button', { name: /Archived \(/ })).toHaveCount(0);
  });

  test('delete asks for confirmation; cancel changes nothing, confirm removes it and opens the next chat', async ({ app, page, backend }) => {
    await app.open();
    await app.openChat('Beta chat');

    await app.menuAction('Beta chat', 'Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete this chat?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(app.header).toHaveText('Beta chat');
    expect(backend.tables.conversations).toHaveLength(3);
    expect(backend.log.some(r => r.method === 'DELETE')).toBe(false);

    await app.menuAction('Beta chat', 'Delete');
    await page.getByRole('dialog', { name: 'Delete this chat?' }).getByRole('button', { name: 'Delete' }).click();

    await expect(app.header).toHaveText('Gamma chat');
    await expect(app.row('Gamma chat')).toHaveAttribute('aria-current', 'page');
    await expect(app.chats.getByText('Beta chat', { exact: true })).toHaveCount(0);
    await expect(app.toast('Chat deleted')).toBeVisible();
    await expect.poll(() => backend.tables.conversations.map(c => c.id)).toEqual(['c1', 'c3']);
    expect(backend.tables.messages.some(m => m.conversation_id === 'c2')).toBe(false);
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.reload();
    await expect(app.row('Alpha chat')).toBeVisible();
    await expect(app.chats.getByText('Beta chat', { exact: true })).toHaveCount(0);
  });

  test('deleting the last chat lands on a clean new chat, not an error', async ({ app, page, backend }) => {
    await app.open();
    for (const title of ['Alpha chat', 'Beta chat']) {
      await app.menuAction(title, 'Delete');
      await page.getByRole('dialog', { name: 'Delete this chat?' }).getByRole('button', { name: 'Delete' }).click();
      await expect(app.chats.getByText(title, { exact: true })).toHaveCount(0);
    }
    await app.openChat('Gamma chat');
    await app.menuAction('Gamma chat', 'Delete');
    await page.getByRole('dialog', { name: 'Delete this chat?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(app.chats.getByText(/No chats yet/)).toBeVisible();
    await expect(page.getByText(/what would you like to get done/i)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => backend.tables.conversations).toHaveLength(0);
  });
});
