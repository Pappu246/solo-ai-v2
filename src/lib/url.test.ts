import { describe, it, expect } from 'vitest';
import { safeHref } from './url';

describe('safeHref', () => {
  it('keeps http and https URLs unchanged', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://example.com')).toBe('http://example.com');
  });

  it('rejects every non-http protocol handler', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined();
    expect(safeHref('java\tscript:alert(1)')).toBeUndefined();
    expect(safeHref('java\nscript:alert(1)')).toBeUndefined();
    expect(safeHref('   javascript:alert(1)   ')).toBeUndefined();
    expect(safeHref('data:text/html,<script>x</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeHref('file:///etc/passwd')).toBeUndefined();
    expect(safeHref('about:blank')).toBeUndefined();
  });

  it('strips control characters and trims valid http/https URLs', () => {
    expect(safeHref('  https://example.com/path  ')).toBe('https://example.com/path');
    expect(safeHref('https://example.com/path\n')).toBe('https://example.com/path');
  });

  it('rejects relative and protocol-relative URLs', () => {
    expect(safeHref('/some/path')).toBeUndefined();
    expect(safeHref('//evil.example/x')).toBeUndefined();
    expect(safeHref('example.com')).toBeUndefined();
  });

  it('rejects empty and nullish input', () => {
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
