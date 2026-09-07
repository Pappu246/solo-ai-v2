/**
 * UI/UX redesign regression + accessibility suite:
 *  - cinematic dark theme is the default; Light/System + accents still work
 *  - keyboard navigation, focus trap, focus restoration
 *  - nested dialogs unwrap one at a time (Escape closes the topmost only)
 *  - mobile drawer + 44px touch targets; desktop icon rail
 *  - safe-area viewport handling; reduced-motion collapse
 *  - axe-core WCAG 2 AA scans on the main surfaces
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { seedConversation, seedMessage } from './support/mockBackend';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

/** A ready knowledge file for the nested-dialog test. */
const FILE_ROW = {
  id: 'f1',
  name: 'design-notes.md',
  mime_type: 'text/markdown',
  size: 1200,
  storage_path: 'u/design-notes.md',
  status: 'ready',
  error: null,
  chunk_count: 1,
  char_count: 900,
  preview: 'Design notes…',
  metadata: { kind: 'markdown', uploaded: true, lines: 40 },
  project_id: null,
  conversation_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

async function openSettings(page: Page) {
  await page.getByRole('button', { name: /settings/i }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map(v => `${v.id} (${v.nodes.length})`);
}

test.describe('cinematic theme defaults', () => {
  test('dark/gold is the default theme on a fresh profile', async ({ page, app }) => {
    await page.goto('/');
    // Pre-paint script + applyTheme agree: dark, with the dark theme-color.
    await expect(page.locator('html')).toHaveClass(/dark/);
    await app.open();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b0a0a');
  });

  test('Light and System themes still work; System follows the OS', async ({ page, app }) => {
    await app.open();
    const dialog = await openSettings(page);

    await dialog.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#faf9f7');

    await dialog.getByRole('radio', { name: 'System' }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await dialog.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('accent options update the accent attribute', async ({ page, app }) => {
    await app.open();
    const dialog = await openSettings(page);
    await dialog.getByRole('radio', { name: 'Blue' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
    await dialog.getByRole('radio', { name: 'Amber' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'amber');
    await page.keyboard.press('Escape');
  });
});

test.describe('keyboard navigation', () => {
  test('Ctrl/Cmd+, opens settings; focus is trapped; Escape closes', async ({ page, app }) => {
    await app.open();
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    // Tabbing around the loop must never leave the dialog.
    const inside = () => page.evaluate(
      sel => {
        const d = document.querySelector(sel) as HTMLElement | null;
        const el = document.activeElement as HTMLElement | null;
        return !!d && !!el && d.contains(el);
      },
      '[role="dialog"][aria-modal="true"]',
    );
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('closing a dialog returns focus to its trigger', async ({ page, app }) => {
    await app.open();
    const trigger = page.getByRole('button', { name: /settings/i }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('nested dialogs', () => {
  test.use({ backendOptions: { files: [FILE_ROW] } });

  test('file detail + delete confirm stack; Escape unwraps one at a time', async ({ page, app }) => {
    await app.open();
    await page.getByRole('navigation', { name: 'Chats' }).getByRole('button', { name: 'Files' }).click();
    await page.getByRole('main').getByRole('button', { name: /design-notes\.md/ }).click();

    const detail = page.getByRole('dialog', { name: 'design-notes.md' });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete this file?' });
    await expect(confirm).toBeVisible();
    expect(await page.getByRole('dialog').count()).toBe(2);

    // First Escape closes only the confirm; the detail stays open.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(detail).toBeVisible();

    // Second Escape closes the detail; the scroll lock is released.
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    // The file is untouched — nothing was confirmed.
    await expect(page.getByRole('main').getByRole('button', { name: /design-notes\.md/ })).toBeVisible();
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('sidebar is a drawer; send control keeps a 44px touch target', async ({ page, app }) => {
    await app.open();
    const backdrop = page.locator('div[aria-hidden="true"].fixed.inset-0');
    await expect(backdrop).toHaveCount(0);

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(backdrop).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();

    // Tap the dimmed area → drawer closes.
    await page.mouse.click(350, 420);
    await expect(backdrop).toHaveCount(0);

    const send = page.getByRole('button', { name: 'Send message' });
    const box = (await send.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('desktop icon rail', () => {
  test('collapsing shows a rail with 44px targets; expand restores the panel', async ({ page, app }) => {
    await app.open();
    await page.keyboard.press('Control+b');
    const rail = page.getByRole('navigation', { name: 'Sidebar rail' });
    await expect(rail).toBeVisible();

    for (const label of ['New chat', 'Expand sidebar', 'Settings']) {
      const box = (await rail.getByRole('button', { name: label }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await rail.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(rail).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
  });
});

test.describe('safe areas', () => {
  test('viewport requests safe areas and the composer honours the bottom inset', async ({ page, app }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await app.open();
    await expect(page.locator('.pb-safe')).toHaveCount(1);
    const usesInsets = await page.evaluate(() =>
      Array.from(document.styleSheets).some(sheet => {
        try {
          return Array.from(sheet.cssRules).some(rule => rule.cssText.includes('safe-area-inset'));
        } catch {
          return false; // cross-origin stylesheet
        }
      }));
    expect(usesInsets).toBe(true);
  });
});

test.describe('reduced motion', () => {
  test('animations collapse to near-zero duration', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const block = page.locator('.animate-rise-in');
    await expect(block).toBeVisible();
    const duration = await block.evaluate(el => getComputedStyle(el).animationDuration);
    const ms = duration.endsWith('ms') ? parseFloat(duration) : parseFloat(duration) * 1000;
    expect(ms).toBeLessThan(0.02); // base is 340ms
  });
});

test.describe('axe (WCAG 2 AA)', () => {
  test('welcome screen has no violations', async ({ page, app }) => {
    await app.open();
    await expect(page.getByText(/what would you like to get done/i)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test.describe('conversation surfaces', () => {
    test.use({
      backendOptions: {
        conversations: [seedConversation('c1', 'Style check', '2026-01-03T00:00:00.000Z')],
        messages: [
          seedMessage('m1', 'c1', 'What is up?', '2026-01-03T00:00:00.000Z'),
          seedMessage('m2', 'c1', 'Echo: What is up?', '2026-01-03T00:00:01.000Z', 'assistant'),
        ],
      },
    });

    test('a conversation with grouped messages has no violations', async ({ page, app }) => {
      await app.open();
      await app.openChat('Style check');
      await expect(page.getByRole('main').locator('[data-role="user"]')).toHaveCount(1);
      await expect(page.getByRole('main').locator('[data-role="assistant"]')).toHaveCount(1);
      expect(await axeViolations(page)).toEqual([]);
    });
  });

  test('the settings dialog has no violations', async ({ page, app }) => {
    await app.open();
    await openSettings(page);
    expect(await axeViolations(page)).toEqual([]);
  });
});
