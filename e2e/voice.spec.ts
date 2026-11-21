import { test, expect } from './support/fixtures';

// A scriptable SpeechRecognition: the browser ends the session after silence, like Chrome does.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __recs: unknown[] };
    w.__recs = [];
    class Rec {
      lang = ''; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onerror: unknown = null; onend: (() => void) | null = null;
      constructor() { w.__recs.push(this); }
      start() {} stop() { this.onend?.(); } abort() {}
    }
    w.SpeechRecognition = Rec;
    w.webkitSpeechRecognition = Rec;
  });
});

test('mic keeps listening after the browser ends the session on silence', async ({ page, app }) => {
  await app.open();
  await page.getByRole('button', { name: 'Voice input' }).click();
  await expect(page.getByText('Listening…')).toBeVisible();
  await page.evaluate(() => { const r = (window as unknown as { __recs: { onend: () => void }[] }).__recs; r[r.length - 1].onend(); });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __recs: unknown[] }).__recs.length)).toBe(2);
  await expect(page.getByRole('button', { name: 'Stop voice input' })).toBeVisible();
});

test('live voice opens, shows listening, and closes with Escape', async ({ page, app }) => {
  await app.open();
  await page.getByRole('button', { name: 'Live voice conversation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Live voice conversation' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Listening… speak now')).toBeVisible();
  await page.screenshot({ path: 'test-results/live-voice.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('settings offers a language picker', async ({ page, app }) => {
  await app.open();
  await page.getByRole('button', { name: /settings/i }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
  const select = dialog.getByLabel('Voice language');
  await select.selectOption('ta-IN');
  await expect(select).toHaveValue('ta-IN');
});
