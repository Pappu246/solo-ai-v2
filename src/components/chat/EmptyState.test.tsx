import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows only the greeting: no clutter above the composer', () => {
    render(<EmptyState />);
    expect(screen.getByRole('heading', { level: 1, name: 'How can I help you today?' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
