import { test, expect } from './support/fixtures';
import { seedConversation, seedMessage } from './support/mockBackend';

const REPLY = '## Highlights\n\n| Topic | Source |\n|---|---|\n| खेल | [1] |\n\nUse **bold** and `code`.\n\n```ts\nconst a = 1;\n```';

test.use({
  backendOptions: {
    conversations: [seedConversation('c1', 'Copy me', '2026-11-07T10:00:00Z')],
    messages: [
      seedMessage('m1', 'c1', 'show a table', '2026-11-07T10:00:00Z'),
      seedMessage('m2', 'c1', REPLY, '2026-11-07T10:00:01Z', 'assistant'),
    ],
  },
});

test('copying a reply puts formatted HTML and Markdown on the clipboard', async ({ page, app, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.open();
  await app.openChat('Copy me');
  const reply = page.locator('[data-role="assistant"]').first();
  await expect(reply.getByRole('table')).toBeVisible();
  await reply.hover();
  await reply.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(reply.getByRole('button', { name: 'Copied' })).toBeVisible();

  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return { types: item.types, html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
  });
  expect(clip.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
  // Formatted: a real table with inline borders, bold, a code block, no app classes or UI buttons.
  expect(clip.html).toMatch(/<table[^>]*border-collapse/);
  expect(clip.html).toMatch(/<th[^>]*>Topic<\/th>/);
  expect(clip.html).toContain('खेल');
  expect(clip.html).toContain('<strong>bold</strong>');
  expect(clip.html).toMatch(/<pre[^>]*><code>/);
  expect(clip.html.replace(/<[^>]+>/g, '')).toContain('const a = 1;');
  expect(clip.html).not.toMatch(/class=|<button/);
  // Plain-text targets still get the Markdown source.
  expect(clip.text).toContain('| Topic | Source |');
  expect(clip.text).toContain('**bold**');
});

test('Save as PDF opens a print document with the whole conversation', async ({ page, app }) => {
  // Headless browsers have no print dialog: record what would be printed instead.
  await page.addInitScript(() => {
    window.print = function (this: Window) {
      (window.top as unknown as { __printed?: string }).__printed = this.document.documentElement.outerHTML;
    };
  });
  await app.open();
  await app.openChat('Copy me');
  await page.getByRole('button', { name: 'Export chat' }).click();
  await expect(page.getByRole('menu', { name: 'Export chat' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Save as PDF' }).click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: string }).__printed ?? '')).toContain('<table>');
  const html = await page.evaluate(() => (window as unknown as { __printed: string }).__printed);
  expect(html).toContain('<h1>Copy me</h1>');
  expect(html).toContain('show a table');
  expect(html).toContain('<th>Topic</th>');
  expect(html).toContain('खेल');
  expect(html).toContain('const a = 1;');
  // The temporary print frame is cleaned up afterwards.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

test('export menu still offers the Markdown download and closes with Escape', async ({ page, app }) => {
  await app.open();
  await app.openChat('Copy me');
  await page.getByRole('button', { name: 'Export chat' }).click();
  await expect(page.getByRole('menuitem', { name: 'Download Markdown (.md)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await page.getByRole('button', { name: 'Export chat' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download Markdown (.md)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^copy-me-\d{4}-\d{2}-\d{2}\.md$/);
});

test('selecting text and pressing Ctrl+C pastes clean HTML without theme colours', async ({ page, app, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.open();
  await app.openChat('Copy me');
  const reply = page.locator('[data-role="assistant"] [data-copy-root]').first();
  await expect(reply.getByRole('table')).toBeVisible();
  await page.evaluate(() => {
    const root = document.querySelector('[data-role="assistant"] [data-copy-root]')!;
    const range = document.createRange();
    range.selectNodeContents(root);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.press('Control+C');
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
  });
  expect(clip.html).toMatch(/<table[^>]*border-collapse/);
  expect(clip.html).toContain('<strong>bold</strong>');
  expect(clip.html).not.toMatch(/color:\s*(rgb|#fff)|var\(--|class=|<button/);
  expect(clip.text).toContain('Topic');
  expect(clip.text).toContain('const a = 1;');
});
