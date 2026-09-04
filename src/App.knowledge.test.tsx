/**
 * Phase 2 UI smoke tests: the Files, Memory and Project views are reachable
 * from the existing sidebar, ⌘K opens global search, and "Remember this"
 * saves a memory only after the user confirms.
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

beforeEach(() => {
  for (const t of Object.keys(mock.tables)) mock.tables[t] = [];
  for (const k of Object.keys(mock.storage)) delete mock.storage[k];
  vi.stubGlobal('fetch', mockChatFetch('Sure, here you go.'));
});

describe('App × knowledge layer', () => {
  it('uploads a file from the Files view and shows its details', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await screen.findByText(/what would you like to get done/i);

    await user.click(screen.getAllByRole('button', { name: 'Files' })[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(['# Plan\n\nShip search in Q4.'], 'plan.md', { type: 'text/markdown' }));

    const row = await screen.findByRole('button', { name: /plan\.md/i });
    await waitFor(() => expect(within(row).getByText('Ready')).toBeInTheDocument());
    expect(mock.tables.files).toHaveLength(1);
    expect(mock.tables.files[0].status).toBe('ready');

    await user.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'plan.md' });
    expect(within(dialog).getByText('Markdown')).toBeInTheDocument();
    expect(within(dialog).getByText('Ready')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('adds a memory explicitly from the Memory view and never from chat alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/what would you like to get done/i);

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'My favourite colour is teal{Enter}');
    await waitFor(() => expect(screen.getByText('Sure, here you go.')).toBeInTheDocument());
    expect(mock.tables.memories).toHaveLength(0);

    await user.click(screen.getAllByRole('button', { name: 'Memory' })[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Memory' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add memory/i }));
    const dialog = await screen.findByRole('dialog', { name: /add memory/i });
    await user.type(within(dialog).getByRole('textbox'), 'Prefers teal in designs');
    await user.click(within(dialog).getByRole('radio', { name: /preference/i }));
    await user.click(within(dialog).getByRole('button', { name: /save memory/i }));

    await waitFor(() => expect(mock.tables.memories).toHaveLength(1));
    expect(mock.tables.memories[0]).toMatchObject({ content: 'Prefers teal in designs', type: 'preference', source: 'user', user_id: 'user-1' });
    expect(await screen.findByText('Prefers teal in designs')).toBeInTheDocument();
  });

  it('creates a project from the sidebar and starts a chat inside it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/what would you like to get done/i);

    await user.click(screen.getByRole('button', { name: /new project/i }));
    const dialog = await screen.findByRole('dialog', { name: /new project/i });
    await user.type(within(dialog).getByLabelText('Name'), 'Website relaunch');
    await user.click(within(dialog).getByRole('button', { name: /create project/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Website relaunch' })).toBeInTheDocument();
    expect(mock.tables.projects).toHaveLength(1);
    expect(screen.getByText(/no chats in this project yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /start the first chat/i }));
    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'Draft the homepage copy{Enter}');
    await waitFor(() => expect(screen.getByText('Sure, here you go.')).toBeInTheDocument());
    expect(mock.tables.conversations[0].project_id).toBe(mock.tables.projects[0].id);
  });

  it('opens global search with ⌘K and navigates to a result', async () => {
    const user = userEvent.setup();
    mock.tables.conversations.push({ id: 'c1', title: 'Falcon pricing', user_id: 'user-1', pinned: false, archived: false, project_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' });
    render(<App />);
    await screen.findByText(/what would you like to get done/i);

    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    await user.type(within(dialog).getByRole('combobox'), 'falcon');
    const option = await within(dialog).findByRole('option', { name: /falcon pricing/i });
    await user.click(option);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { level: 1, name: 'Falcon pricing' })).toBeInTheDocument();
  });
});
