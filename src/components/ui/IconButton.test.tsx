import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('renders button with correct aria-label', () => {
    render(<IconButton label="Settings" />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Settings');
  });

  it('renders visual tooltip with role="tooltip"', () => {
    render(<IconButton label="Attach file" />);
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Attach file');
  });

  it('allows disabling the visual tooltip via showTooltip prop', () => {
    render(<IconButton label="Close" showTooltip={false} />);
    const tooltip = screen.queryByRole('tooltip', { hidden: true });
    expect(tooltip).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('title', 'Close');
  });

  it('sets aria-pressed when active prop is provided', () => {
    render(<IconButton label="Voice input" active />);
    const button = screen.getByRole('button', { name: 'Voice input' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles disabled state properly', () => {
    render(<IconButton label="Send" disabled />);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeDisabled();
  });
});
