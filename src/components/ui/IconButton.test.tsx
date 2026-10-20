import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButton } from './IconButton';
import { Copy } from 'lucide-react';

describe('IconButton', () => {
  it('renders with accessible label and title tooltip', () => {
    render(
      <IconButton label="Copy message">
        <Copy className="w-4 h-4" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Copy message' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Copy message');
  });

  it('includes focus-visible ring styles for keyboard navigation', () => {
    render(
      <IconButton label="Settings">
        <Copy className="w-4 h-4" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.className).toContain('focus-visible:ring-accent');
  });

  it('does not apply pointer-events-none when disabled so tooltip and cursor work', () => {
    render(
      <IconButton label="Disabled button" disabled>
        <Copy className="w-4 h-4" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Disabled button' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('disabled:cursor-not-allowed');
    expect(button.className).not.toContain('disabled:pointer-events-none');
  });

  it('supports aria-live attribute for dynamic status updates', () => {
    render(
      <IconButton label="Copied to clipboard" aria-live="polite">
        <Copy className="w-4 h-4" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Copied to clipboard' });
    expect(button).toHaveAttribute('aria-live', 'polite');
  });
});
