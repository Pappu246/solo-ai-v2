import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSelector } from './ModelSelector';
import type { AIModel } from '../../types';

const MODELS: AIModel[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    category: 'conversation',
    speed: 4,
    quality: 5,
    cost: 4,
    free: false,
    context_length: 128_000,
    supports_vision: true,
    supports_tools: true,
  },
  {
    id: 'claude-3',
    name: 'Claude 3',
    provider: 'anthropic',
    category: 'conversation',
    speed: 3,
    quality: 5,
    cost: 3,
    free: false,
    context_length: 200_000,
    supports_vision: true,
    supports_tools: true,
  },
  {
    id: 'gemini-flash',
    name: 'Gemini Flash',
    provider: 'google',
    category: 'fast',
    speed: 5,
    quality: 4,
    cost: 1,
    free: true,
    context_length: 32_000,
    supports_vision: false,
    supports_tools: true,
  },
];

describe('ModelSelector', () => {
  it('opens the dropdown when the trigger button is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ModelSelector models={MODELS} selected={null} onSelect={onSelect} />);

    // Dropdown should not be visible initially.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /auto/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes the dropdown on Escape', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ModelSelector models={MODELS} selected={null} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /auto/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the dropdown when clicking outside', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <div>
        <ModelSelector models={MODELS} selected={null} onSelect={onSelect} />
        <button>Outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /auto/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(screen.getByText('Outside'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onSelect with the correct model id when a model is chosen', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ModelSelector models={MODELS} selected={null} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /auto/i }));
    await user.click(screen.getByRole('option', { name: /GPT-4o/i }));

    expect(onSelect).toHaveBeenCalledWith('gpt-4o');
    // Dropdown closes after selection.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onSelect with null when Auto is selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ModelSelector models={MODELS} selected="gpt-4o" onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /GPT-4o/i }));
    await user.click(screen.getByRole('option', { name: /Auto/i }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('uses the glass-menu class for the dropdown panel', async () => {
    const user = userEvent.setup();
    render(<ModelSelector models={MODELS} selected={null} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /auto/i }));
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('glass-menu');
  });

  it('renders with z-50 to stay above page content', async () => {
    const user = userEvent.setup();
    render(<ModelSelector models={MODELS} selected={null} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /auto/i }));
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('z-50');
  });
});
