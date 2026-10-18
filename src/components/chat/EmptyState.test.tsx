import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows the workspace heading and available quick-start workflows', () => {
    render(<EmptyState onSuggestion={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'What would you like to get done?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Quick starts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /write and debug code/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /understand a difficult topic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /make sense of a document/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn an idea into a plan/i })).toBeInTheDocument();
  });

  it('sends the selected starter prompt through the existing chat action', async () => {
    const user = userEvent.setup();
    const onSuggestion = vi.fn();
    render(<EmptyState onSuggestion={onSuggestion} />);

    await user.click(screen.getByRole('button', { name: /write and debug code/i }));

    expect(onSuggestion).toHaveBeenCalledWith(
      'Help me write or debug code. Ask for any missing requirements, then propose a minimal implementation and relevant tests.',
    );
  });
});
