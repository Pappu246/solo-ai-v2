import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders GFM tables, lists and links safely', () => {
    render(<Markdown content={'| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n[site](https://example.com)'} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    const link = screen.getByRole('link', { name: 'site' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders fenced code blocks with a language label and copy button', () => {
    render(<Markdown content={'```ts\nconst x = 1;\n```'} />);
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('never renders raw HTML', () => {
    const { container } = render(<Markdown content={'<img src=x onerror="alert(1)">hello'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('hello');
  });
});
