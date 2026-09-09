import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('prose-chat table styles', () => {
  const css = readFileSync(resolve(__dirname, 'index.css'), 'utf-8');

  it('uses border-collapse: separate for rounded corners', () => {
    expect(css).toMatch(/\.prose-chat table\s*\{[^}]*border-collapse:\s*separate/);
  });

  it('applies rounded corners via border-radius', () => {
    expect(css).toMatch(/\.prose-chat table\s*\{[^}]*border-radius:\s*var\(--radius\)/);
  });

  it('uses a soft semi-transparent outer border', () => {
    // Outer border should use rgb(var(--border) / <alpha>) with alpha < 1.
    expect(css).toMatch(/\.prose-chat table\s*\{[^}]*border:\s*1px solid rgb\(var\(--border\)\s*\/\s*0\.\d+\)/);
  });

  it('gives the header row a surface-2 background and bold text', () => {
    expect(css).toMatch(/\.prose-chat th\s*\{[^}]*background:\s*rgb\(var\(--surface-2\)\)/);
    expect(css).toMatch(/\.prose-chat th\s*\{[^}]*font-weight:\s*600/);
  });

  it('uses thin muted dividers instead of harsh grid borders', () => {
    // Cell borders should be border-bottom with reduced opacity.
    expect(css).toMatch(/\.prose-chat th,\s*\.prose-chat td\s*\{[^}]*border-bottom:\s*1px solid rgb\(var\(--border\)\s*\/\s*0\.\d+\)/);
  });

  it('provides alternating row backgrounds', () => {
    expect(css).toMatch(/\.prose-chat tbody tr:nth-child\(even\)\s*\{[^}]*background:\s*rgb\(var\(--surface-2\)\s*\/\s*0\.\d+\)/);
  });

  it('strips the bottom border from the last body row', () => {
    expect(css).toMatch(/\.prose-chat tbody tr:last-child td\s*\{[^}]*border-bottom:\s*0/);
  });

  it('enables horizontal scroll for wide tables', () => {
    expect(css).toMatch(/\.prose-chat table\s*\{[^}]*display:\s*block[^}]*overflow-x:\s*auto/);
  });
});
