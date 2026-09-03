import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  mock.tables.conversations = [];
  mock.tables.messages = [];
  vi.stubGlobal('fetch', mockChatFetch('Sure, here you go.', {
    models: [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', category: 'conversation', speed: 4, quality: 5, cost: 4, free: false, context_length: 128000, supports_vision: true, supports_tools: true }],
  }));
});

describe('App', () => {
  it('renders the shell, sends a message and shows the reply', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText(/what would you like to get done/i);
    expect(screen.getAllByRole('button', { name: /new chat/i })[0]).toBeInTheDocument();

    const box = screen.getByRole('textbox', { name: /message/i });
    await user.type(box, 'Write a haiku{Enter}');

    await waitFor(() => expect(screen.getByText('Sure, here you go.')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Write a haiku' })).toBeInTheDocument();
    // Sidebar lists the new chat.
    expect(screen.getAllByText('Write a haiku').length).toBeGreaterThanOrEqual(2);
  });

  it('asks for confirmation before deleting a chat', async () => {
    const user = userEvent.setup();
    mock.tables.conversations.push({ id: 'c1', title: 'Old chat', user_id: 'user-1', pinned: false, archived: false, created_at: '2026-01-01', updated_at: '2026-01-01' });
    render(<App />);

    const options = await screen.findAllByRole('button', { name: /options for old chat/i });
    await user.click(options[0]);
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    const dialog = await screen.findByRole('dialog', { name: /delete this chat/i });
    expect(dialog).toBeInTheDocument();
    expect(mock.tables.conversations).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mock.tables.conversations).toHaveLength(0));
  });

  it('opens settings and applies the theme immediately', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/what would you like to get done/i);

    await user.click(screen.getAllByRole('button', { name: /settings/i })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(dialog).toBeInTheDocument();
  });
});
