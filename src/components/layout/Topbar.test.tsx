import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Topbar } from './Topbar';
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
];

const defaultProps = {
  title: null,
  models: MODELS,
  selectedModel: null,
  onSelectModel: vi.fn(),
  sidebarCollapsed: false,
  onOpenSidebar: vi.fn(),
  onOpenMobileSidebar: vi.fn(),
};

describe('Topbar', () => {
  it('applies relative z-30 for proper stacking above page content', () => {
    render(<Topbar {...defaultProps} />);
    const header = screen.getByRole('banner') ?? document.querySelector('header')!;
    expect(header.className).toContain('relative');
    expect(header.className).toContain('z-30');
  });

  it('updates the model label after picking a new model', async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    const { rerender } = render(
      <Topbar {...defaultProps} onSelectModel={onSelectModel} />,
    );

    // Initially shows "Auto" since selectedModel is null.
    expect(screen.getByRole('button', { name: /auto/i })).toBeInTheDocument();

    // Open the dropdown and select a model.
    await user.click(screen.getByRole('button', { name: /auto/i }));
    await user.click(screen.getByRole('option', { name: /GPT-4o/i }));

    // The callback was fired.
    expect(onSelectModel).toHaveBeenCalledWith('gpt-4o');

    // Re-render with the new selection (simulating parent state update).
    rerender(
      <Topbar {...defaultProps} selectedModel="gpt-4o" onSelectModel={onSelectModel} />,
    );
    // The button now shows the model name, not "Auto".
    expect(screen.getByRole('button', { name: /GPT-4o/i })).toBeInTheDocument();
  });
});
