/**
 * Phase 3 · Chunk 5: the sidebar, the page header and the open chat agree
 * after every conversation action, without a reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockChatFetch } from './test/mockSupabase';

const mock = await vi.hoisted(async () => (await import('./test/mockSupabase')).createMockSupabase());
vi.mock('./lib/supabase', () => ({
  supabase: mock.client,
  isSupabaseConfigured: true,
  CHAT_FUNCTION_URL: 'https://x.supabase.co/functions/v1/chat',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_URL: 'https://x.supabase.co',
}));

import App from './App';

const row = (id: string, title: string, updated_at: string, extra: Record<string, unknown> = {}) =>
  ({ id, title, user_id: 'user-1', pinned: false, archived: false, project_id: null, created_at: updated_at, updated_at, ...extra });

beforeEach(() => {
  for (const t of Object.keys(mock.tables)) mock.tables[t] = [];
  mock.tables.conversations = [
    row('c1', 'Alpha chat', '2026-01-03T00:00:00.000Z'),
    row('c2', 'Beta chat', '2026-01-02T00:00:00.000Z'),
    row('c3', 'Gamma chat', '2026-01-01T00:00:00.000Z'),
  ];
  mock.tables.messages = [
    { id: 'm1', conversation_id: 'c1', user_id: 'user-1', role: 'user', content: 'alpha question', created_at: '2026-01-03T00:00:00.000Z' },
    { id: 'm2', conversation_id: 'c2', user_id: 'user-1', role: 'user', content: 'beta question', created_at: '2026-01-02T00:00:00.000Z' },
  ];
  vi.stubGlobal('fetch', mockChatFetch('Sure.'));
});

const chatsNav = () => screen.getByRole('navigation', { name: 'Chats' });
const chatButton = (title: string) => within(chatsNav()).getByRole('button', { name: new RegExp(`^${title}$`, 'i') });
const openMenuFor = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  await user.click(within(chatsNav()).getByRole('button', { name: `Options for ${title}` }));
  return screen.getByRole('menu');
};
/** The page title in the top bar (the empty-state greeting is also an h1). */
const heading = () => within(screen.getByRole('banner')).getByRole('heading', { level: 1 });

describe('App × conversation sync', () => {
  it('renaming the open chat updates the header and sidebar together and keeps it open', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await within(await screen.findByRole('navigation', { name: 'Chats' })).findByRole('button', { name: /^alpha chat$/i }));
    await screen.findByText('alpha question');
    expect(heading()).toHaveTextContent('Alpha chat');

    const menu = await openMenuFor(user, 'Alpha chat');
    await user.click(within(menu).getByRole('menuitem', { name: /rename/i }));
    const input = screen.getByRole('textbox', { name: /rename chat/i });
    await user.clear(input);
    await user.type(input, 'Alpha renamed{Enter}');

    await waitFor(() => expect(heading()).toHaveTextContent('Alpha renamed'));
    expect(chatButton('Alpha renamed')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('alpha question')).toBeInTheDocument(); // still the same open chat
    await waitFor(() => expect(mock.tables.conversations.find(c => c.id === 'c1')?.title).toBe('Alpha renamed'));
    expect(within(chatsNav()).queryByRole('button', { name: /^alpha chat$/i })).not.toBeInTheDocument();
  });

  it('deleting the open chat (after confirming) opens the next chat; cancelling changes nothing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await within(await screen.findByRole('navigation', { name: 'Chats' })).findByRole('button', { name: /^beta chat$/i }));
    await screen.findByText('beta question');

    // Cancel first.
    let menu = await openMenuFor(user, 'Beta chat');
    await user.click(within(menu).getByRole('menuitem', { name: /delete/i }));
    await screen.findByRole('dialog', { name: /delete this chat/i });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /delete this chat/i })).not.toBeInTheDocument());
    expect(heading()).toHaveTextContent('Beta chat');
    expect(mock.tables.conversations).toHaveLength(3);

    // Now confirm.
    menu = await openMenuFor(user, 'Beta chat');
    await user.click(within(menu).getByRole('menuitem', { name: /delete/i }));
    await screen.findByRole('dialog', { name: /delete this chat/i });
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // Beta sat between Alpha and Gamma → Gamma is next in sidebar order.
    await waitFor(() => expect(heading()).toHaveTextContent('Gamma chat'));
    expect(chatButton('Gamma chat')).toHaveAttribute('aria-current', 'page');
    expect(within(chatsNav()).queryByRole('button', { name: /^beta chat$/i })).not.toBeInTheDocument();
    await waitFor(() => expect(mock.tables.conversations.map(c => c.id)).toEqual(['c1', 'c3']));
    expect(screen.queryByText(/something went wrong|no access|not found/i)).not.toBeInTheDocument();
  });

  it('archiving the open chat opens its neighbour and moves it to the Archived section', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await within(await screen.findByRole('navigation', { name: 'Chats' })).findByRole('button', { name: /^alpha chat$/i }));
    await screen.findByText('alpha question');

    const menu = await openMenuFor(user, 'Alpha chat');
    await user.click(within(menu).getByRole('menuitem', { name: /^archive$/i }));

    await waitFor(() => expect(heading()).toHaveTextContent('Beta chat'));
    await screen.findByText('beta question');
    expect(chatButton('Beta chat')).toHaveAttribute('aria-current', 'page');
    const archivedToggle = within(chatsNav()).getByRole('button', { name: /archived \(1\)/i });
    await user.click(archivedToggle);
    expect(chatButton('Alpha chat')).not.toHaveAttribute('aria-current');
    await waitFor(() => expect(mock.tables.conversations.find(c => c.id === 'c1')?.archived).toBe(true));

    // Unarchive: it returns to the list at the top (most recently updated) and the open chat stays put.
    const restoreMenu = await openMenuFor(user, 'Alpha chat');
    await user.click(within(restoreMenu).getByRole('menuitem', { name: /unarchive/i }));
    await waitFor(() => expect(mock.tables.conversations.find(c => c.id === 'c1')?.archived).toBe(false));
    expect(heading()).toHaveTextContent('Beta chat');
    expect(within(chatsNav()).queryByRole('button', { name: /archived \(/i })).not.toBeInTheDocument();
  });

  it('pinning the open chat moves it to Pinned without changing the selection', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await within(await screen.findByRole('navigation', { name: 'Chats' })).findByRole('button', { name: /^gamma chat$/i }));
    await waitFor(() => expect(heading()).toHaveTextContent('Gamma chat'));

    const menu = await openMenuFor(user, 'Gamma chat');
    await user.click(within(menu).getByRole('menuitem', { name: /^pin$/i }));

    // The row now carries the pin icon (accessible name "Pinned Gamma chat") and stays selected.
    const pinnedRow = await within(chatsNav()).findByRole('button', { name: /^pinned gamma chat$/i });
    expect(pinnedRow).toHaveAttribute('aria-current', 'page');
    expect(heading()).toHaveTextContent('Gamma chat');
    await waitFor(() => expect(mock.tables.conversations.find(c => c.id === 'c3')?.pinned).toBe(true));
    // First list item is now the pinned chat, as it will be after a reload.
    const buttons = within(chatsNav()).getAllByRole('button', { name: /chat$/i });
    expect(buttons[0]).toHaveTextContent('Gamma chat');
    expect(within(chatsNav()).getByText('Pinned')).toBeInTheDocument();

    // Unpin from the same menu: back into Recent, still selected.
    const again = await openMenuFor(user, 'Gamma chat');
    await user.click(within(again).getByRole('menuitem', { name: /unpin/i }));
    await waitFor(() => expect(mock.tables.conversations.find(c => c.id === 'c3')?.pinned).toBe(false));
    expect(chatButton('Gamma chat')).toHaveAttribute('aria-current', 'page');
    expect(within(chatsNav()).queryByText('Pinned')).not.toBeInTheDocument();
  });
});
