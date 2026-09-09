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

  it('renders a multi-column table with proper thead/tbody structure for polished styling', () => {
    const { container } = render(
      <Markdown content={'| Name | Age | Role |\n|------|-----|------|\n| Alice | 30 | Engineer |\n| Bob | 25 | Designer |\n| Carol | 35 | Manager |'} />
    );
    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    // Table sits inside the prose-chat wrapper so CSS rules apply.
    const wrapper = container.querySelector('.prose-chat');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.contains(table!)).toBe(true);

    // Proper thead/tbody structure (needed for :nth-child, th, tbody selectors).
    const thead = table!.querySelector('thead');
    const tbody = table!.querySelector('tbody');
    expect(thead).not.toBeNull();
    expect(tbody).not.toBeNull();

    // Header row has the right number of th cells.
    expect(thead!.querySelectorAll('th')).toHaveLength(3);
    // Body has all data rows.
    expect(tbody!.querySelectorAll('tr')).toHaveLength(3);
    // Each body row has 3 cells.
    for (const tr of tbody!.querySelectorAll('tr')) {
      expect(tr.querySelectorAll('td')).toHaveLength(3);
    }
    // Last body row is identifiable so CSS can strip its bottom border.
    const lastRow = tbody!.querySelector('tr:last-child');
    expect(lastRow).not.toBeNull();
    expect(lastRow!.querySelectorAll('td')[0].textContent).toBe('Carol');
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

  // ── Math (KaTeX) ─────────────────────────────────────────────────────────────

  it('renders inline $…$ math with KaTeX', () => {
    const { container } = render(<Markdown content={'The answer is $E = mc^2$, clearly.'} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).toContain('The answer is');
    expect(container.querySelector('.katex-display')).toBeNull(); // inline, not display
  });

  it('renders $$…$$ display math as a centered block', () => {
    const { container } = render(<Markdown content={'Intro:\n\n$$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$$\n\nOutro.'} />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.querySelector('.katex-display .katex')).not.toBeNull();
    expect(container.textContent).toContain('Intro:');
    expect(container.textContent).toContain('Outro.');
  });

  it('normalizes \\(…\\) and \\[…\\] delimiters to KaTeX', () => {
    const { container } = render(<Markdown content={'Inline \\(a+b\\) and display\n\n\\[c = d^2\\]\n\ndone.'} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not treat currency-like dollars as math', () => {
    const { container } = render(<Markdown content={'It costs $5 and $10 total.'} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toContain('It costs $5 and $10 total.');
  });

  it('keeps math inside code blocks as plain code', () => {
    render(<Markdown content={'```tex\n$not math$\n```'} />);
    expect(screen.getByText('tex')).toBeInTheDocument();
    expect(screen.getByText('$not math$')).toBeInTheDocument();
  });

  it('does not crash on half-written math while streaming', () => {
    const { container } = render(<Markdown content={'deriving $$\\frac{a}{'} live />);
    expect(container.textContent).toContain('deriving');
  });

  // ── SVG rendering ────────────────────────────────────────────────────────────

  it('renders a fenced svg block as a sanitized graphic', () => {
    const { container } = render(
      <Markdown content={'Here is an icon:\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>\n```'} />,
    );
    const figure = container.querySelector('[data-testid="svg-figure"]');
    expect(figure).not.toBeNull();
    expect(figure!.querySelectorAll('svg circle')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /copy svg source/i })).toBeInTheDocument();
  });

  it('sanitizes a fenced svg block before rendering it', () => {
    const { container } = render(
      <Markdown content={'```svg\n<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>steal()</script><circle r="1" onclick="pwn()"/></svg>\n```'} />,
    );
    const figure = container.querySelector('[data-testid="svg-figure"]');
    expect(figure).not.toBeNull();
    expect(figure!.querySelector('script')).toBeNull();
    expect(figure!.querySelectorAll('circle')).toHaveLength(1);
    expect(figure!.querySelector('circle')!.getAttribute('onclick')).toBeNull();
    expect(figure!.querySelector('svg')!.getAttribute('onload')).toBeNull();
  });

  it('falls back to a code block when a fenced svg does not parse', () => {
    render(<Markdown content={'```svg\n<svg><circle r="'} />);
    // Malformed markup must never be injected — show it as code instead.
    expect(screen.getByText(/<circle r="/)).toBeInTheDocument();
    expect(screen.queryByTestId('svg-figure')).toBeNull();
  });

  it('renders a block-level inline <svg> from the reply text', () => {
    const { container } = render(
      <Markdown content={'Sure:\n\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="teal"/></svg>\n\nHope that helps!'} />,
    );
    const figure = container.querySelector('[data-testid="svg-figure"]');
    expect(figure).not.toBeNull();
    expect(figure!.querySelector('[role="img"] rect')).not.toBeNull();
    expect(container.textContent).toContain('Hope that helps!');
  });

  it('sanitizes a block-level inline <svg> too', () => {
    const { container } = render(
      <Markdown content={'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body onload="x()"/></foreignObject><path d="M0 0"/></svg>'} />,
    );
    const figure = container.querySelector('[data-testid="svg-figure"]');
    expect(figure).not.toBeNull();
    expect(figure!.querySelector('foreignObject')).toBeNull();
    expect(figure!.querySelectorAll('[role="img"] > svg > path')).toHaveLength(1);
  });

  it('shows svg source as code while streaming, graphic when complete', () => {
    const code = '```svg\n<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>\n```';
    const live = render(<Markdown content={code} live />);
    expect(live.container.querySelector('[data-testid="svg-figure"] svg circle')).toBeNull();
    expect(live.getByText(/<circle r="2"\/>/)).toBeInTheDocument();
    live.unmount();

    const done = render(<Markdown content={code} />);
    expect(done.container.querySelector('[data-testid="svg-figure"] svg circle')).not.toBeNull();
  });

  it('does not render an svg that sits inside a fenced code block of another language', () => {
    const { container } = render(<Markdown content={'```html\n<svg><circle/></svg>\n```'} />);
    expect(container.querySelector('[data-testid="svg-figure"]')).toBeNull();
    expect(container.querySelector('[role="img"] svg')).toBeNull(); // html fence → code, not graphic
    // The markup stays visible as code text instead.
    expect(container.textContent).toContain('<svg><circle/></svg>');
  });
});
