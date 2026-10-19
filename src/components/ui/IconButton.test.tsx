import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('renders with accessibility attributes aria-label and title', () => {
    render(<IconButton label="Close panel" />);
    const button = screen.getByRole('button', { name: 'Close panel' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Close panel');
    expect(button).toHaveAttribute('title', 'Close panel');
  });

  it('reflects active state using aria-pressed', () => {
    render(<IconButton label="Toggle bookmark" active />);
    const button = screen.getByRole('button', { name: 'Toggle bookmark' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('includes focus-visible ring utility classes for keyboard accessibility', () => {
    render(<IconButton label="Settings" />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.className).toContain('focus-visible:ring-accent');
  });
});
