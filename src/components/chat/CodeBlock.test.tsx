import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock component', () => {
  it('renders code content and updates screen reader status on copy', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<CodeBlock code="const x = 42;" language="typescript" />);

    expect(screen.getByText('typescript')).toBeInTheDocument();
    const copyButton = screen.getByRole('button', { name: /copy code/i });
    expect(copyButton).toBeInTheDocument();

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveTextContent('');

    await user.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith('const x = 42;');
    expect(statusRegion).toHaveTextContent('Code copied to clipboard');
  });
});
