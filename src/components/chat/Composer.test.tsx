import { render, screen } from '@testing-library/react';
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
