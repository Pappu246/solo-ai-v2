import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { MockBackend, type MockBackendOptions } from './mockBackend';

/**
 * `test.use({ backend: { ...seed } })` per file/describe; `backend` in the test
 * body is the live MockBackend so assertions can read its tables and log.
 */
export const test = base.extend<{ backendOptions: MockBackendOptions; backend: MockBackend; app: AppPage }>({
  backendOptions: [{}, { option: true }],
  backend: async ({ page, backendOptions }, provide) => {
    const backend = new MockBackend(backendOptions);
    await backend.install(page);
    await provide(backend);
  },
  app: async ({ page, backend }, provide) => {
    void backend; // ensure routes are installed before navigation
    await provide(new AppPage(page));
  },
});

export { expect };

/** Small page-object over the shell: sidebar rows, menus, header, composer. */
export class AppPage {
  readonly page: Page;
  constructor(page: Page) { this.page = page; }

  async open() {
    await this.page.goto('/');
    await expect(this.page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
  }

  get chats(): Locator { return this.page.getByRole('navigation', { name: 'Chats' }); }
  get header(): Locator { return this.page.getByRole('banner').getByRole('heading', { level: 1 }); }
  get composer(): Locator { return this.page.getByRole('textbox', { name: 'Message' }); }
  get sendButton(): Locator { return this.page.getByRole('button', { name: 'Send message' }); }
  get stopButton(): Locator { return this.page.getByRole('button', { name: 'Stop generating' }); }

  /** Sidebar row button for a chat (pinned rows carry a leading "Pinned" icon label). */
  row(title: string): Locator { return this.chats.getByRole('button', { name: new RegExp(`^(Pinned )?${escape(title)}$`) }); }

  async openChat(title: string) {
    await this.row(title).click();
    await expect(this.header).toHaveText(title);
  }

  async openMenu(title: string): Promise<Locator> {
    // `has` is resolved relative to the <li>, so the inner locator must be page-rooted.
    const li = this.chats.locator('li').filter({ has: this.page.getByRole('button', { name: new RegExp(`^(Pinned )?${escape(title)}$`) }) });
    await li.hover();
    await li.getByRole('button', { name: `Options for ${title}` }).click();
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }

  async menuAction(title: string, item: string | RegExp) {
    const menu = await this.openMenu(title);
    await menu.getByRole('menuitem', { name: item }).click();
  }

  async rename(title: string, next: string) {
    await this.menuAction(title, 'Rename');
    const input = this.page.getByRole('textbox', { name: 'Rename chat' });
    await input.fill(next);
    await input.press('Enter');
  }

  async send(text: string) {
    await this.composer.fill(text);
    await this.composer.press('Enter');
  }

  message(text: string | RegExp): Locator { return this.page.getByRole('main').getByText(text).first(); }

  toast(text: string | RegExp): Locator { return this.page.getByRole('status').filter({ hasText: text }).or(this.page.getByRole('alert').filter({ hasText: text })).first(); }
}

function escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
