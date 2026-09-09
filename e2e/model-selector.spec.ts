/**
 * Regression: the ModelSelector dropdown was too transparent (the shared .glass
 * utility uses ~68% opacity in dark mode) and the Topbar's backdrop-filter
 * created a stacking context that trapped the dropdown below the welcome-screen
 * suggestion cards, so clicks on a model option would land on a card instead.
 *
 * This test verifies:
 *   - The dropdown uses the denser .glass-menu class (alpha >= 0.9).
 *   - The dropdown z-index is 50 (above page content).
 *   - The Topbar header has z-30 (above page content, below sidebar/dialogs).
 *   - A hit-test confirms the dropdown receives clicks, not the card behind it.
 */
import { test, expect } from './support/fixtures';

test.use({ backendOptions: { conversations: [], messages: [] } });

test.describe('model selector dropdown stacking', () => {
  test('dropdown has dense background and correct z-index over the welcome screen', async ({ page, app }) => {
    await app.open();

    // Confirm we are on the welcome screen (no chats).
    await expect(page.getByText(/what would you like to get done/i)).toBeVisible();

    // Open the model selector.
    const trigger = page.getByRole('button', { name: /auto/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = page.getByRole('listbox', { name: 'Model' });
    await expect(dropdown).toBeVisible();

    // --- Class checks ---
    // The dropdown must use the glass-menu utility (not the lighter glass).
    await expect(dropdown).toHaveClass(/glass-menu/);
    // z-50 ensures the dropdown sits above page content including suggestion cards.
    await expect(dropdown).toHaveClass(/z-50/);

    // --- Computed style checks ---
    // Verify the Topbar header has the correct stacking context.
    const header = page.locator('header').first();
    const headerZIndex = await header.evaluate(el => {
      return parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
    });
    expect(headerZIndex).toBeGreaterThanOrEqual(30);
    await expect(header).toHaveClass(/relative/);
    await expect(header).toHaveClass(/z-30/);

    // Verify the dropdown background alpha >= 0.9.
    const bgAlpha = await dropdown.evaluate(el => {
      const bg = window.getComputedStyle(el).backgroundColor;
      // Parse rgba(r, g, b, a) or rgb(r, g, b).
      const match = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (!match) return 1; // If no match, assume fully opaque.
      return match[4] !== undefined ? parseFloat(match[4]) : 1;
    });
    expect(bgAlpha).toBeGreaterThanOrEqual(0.9);

    // --- Hit-test: click on a model option should land on the dropdown, not on
    // the suggestion card beneath it. ---
    // Get the dropdown's bounding box; click in its center.
    const dropdownBox = await dropdown.boundingBox();
    expect(dropdownBox).not.toBeNull();
    const clickX = dropdownBox!.x + dropdownBox!.width / 2;
    const clickY = dropdownBox!.y + dropdownBox!.height / 2;

    // The element at the click point should be inside the dropdown (not a card behind it).
    const topElement = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const listbox = el.closest('[role="listbox"]');
        const option = el.closest('[role="option"]');
        return {
          tag: el.tagName,
          isInsideListbox: !!listbox,
          isOption: !!option,
        };
      },
      [clickX, clickY],
    );
    expect(topElement).not.toBeNull();
    expect(topElement!.isInsideListbox).toBe(true);
  });
});
