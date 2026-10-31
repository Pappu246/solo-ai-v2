import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Composer } from './Composer';

describe('Composer', () => {
  const defaultProps = {
    onSend: vi.fn(),
    onStop: vi.fn(),
    isGenerating: false,
    sendOnEnter: true,
  };

  it('shows "Enter a message or attach a file" title on Send button when input is empty', () => {
    render(<Composer {...defaultProps} />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Enter a message or attach a file');
  });

  it('shows "Offline — reconnect to send message" title when offline prop is true', () => {
    render(<Composer {...defaultProps} offline={true} />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Offline — reconnect to send message');
  });

  it('shows "Messaging is disabled" title when disabled prop is true', () => {
    render(<Composer {...defaultProps} disabled={true} />);
    const button = screen.getByRole('button', { name: 'Send message' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Messaging is disabled');
  });

  it('shows "Stop generating" aria-label and title when isGenerating is true', () => {
    render(<Composer {...defaultProps} isGenerating={true} />);
    const button = screen.getByRole('button', { name: 'Stop generating' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('title', 'Stop generating');
  });
});

describe('Composer plus menu', () => {
  const setup = () => render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} sendOnEnter />);

  it('keeps the bar clean: one plus button, tools only inside its menu', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('menuitem', { name: 'Attach files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Web research' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add files and tools' }));
    expect(screen.getByRole('menuitem', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /Web search/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /Agent mode/ })).toBeInTheDocument();
  });

  it('turning on web search shows a removable chip and a check mark', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Add files and tools' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Web search/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: /Web search/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Turn off web search' }));
    expect(screen.queryByRole('button', { name: 'Turn off web search' })).not.toBeInTheDocument();
  });
});
