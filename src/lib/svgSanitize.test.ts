import { describe, it, expect } from 'vitest';
import { sanitizeSvg, isSvgSource } from './svgSanitize';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="gold" stroke="#333"/></svg>`;

/** Parse sanitized output back into a DOM for assertions. */
function parse(out: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc.documentElement as unknown as SVGSVGElement;
}

describe('sanitizeSvg', () => {
  it('keeps a plain shape-only SVG', () => {
    const out = sanitizeSvg(ICON);
    expect(out).toBeTruthy();
    const svg = parse(out!);
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    expect(svg.querySelector('circle')!.getAttribute('fill')).toBe('gold');
  });

  it('keeps gradients, defs and text', () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <defs><linearGradient id="g"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs>
        <rect width="10" height="10" fill="url(#g)"/>
        <text x="1" y="5" font-size="2">hi</text>
      </svg>`,
    );
    expect(out).toBeTruthy();
    const svg = parse(out!);
    expect(svg.querySelectorAll('linearGradient, stop, rect, text')).toHaveLength(5);
    // `url(#g)` is an in-document reference and must survive.
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('url(#g)');
  });

  it('strips <script> elements', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="1"/></svg>`);
    expect(out).toBeTruthy();
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('strips event handler attributes', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="1" onclick="steal()"/></svg>`);
    expect(out).toBeTruthy();
    expect(out!.toLowerCase()).not.toContain('onload');
    expect(out!.toLowerCase()).not.toContain('onclick');
    expect(out!.toLowerCase()).not.toContain('steal');
    parse(out!); // still valid SVG
  });

  it('strips <foreignObject> entirely', () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject></svg>`,
    );
    expect(out).toBeTruthy();
    expect(out).not.toContain('foreignObject');
    expect(out).not.toContain('onerror');
  });

  it('strips <style> elements and style attributes', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(http://evil.example/x.css)</style><circle r="1" style="background:url(http://evil.example)"/></svg>`);
    expect(out).toBeTruthy();
    expect(out).not.toContain('style');
    expect(out).not.toContain('evil.example');
  });

  it('strips external hrefs and javascript: URLs', () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <use xlink:href="https://evil.example/x.svg#y"/>
        <a href="javascript:alert(1)"><circle r="1"/></a>
        <image href="http://evil.example/pixel.png"/>
      </svg>`,
    );
    expect(out).toBeTruthy();
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('javascript:');
    // `<a>` is not in the element allowlist, but the nested shape survives.
    const svg = parse(out!);
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
  });

  it('keeps same-document use references, drops everything else about href', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><defs><circle id="dot" r="1"/></defs><use href="#dot" x="2"/></svg>`);
    expect(out).toBeTruthy();
    const svg = parse(out!);
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#dot');
  });

  it('strips SMIL animation elements', () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://x.example"><animate attributeName="href" values="https://evil.example"/></a><circle r="1"/></svg>`,
    );
    expect(out).toBeTruthy();
    expect(out).not.toContain('animate');
    expect(out).not.toContain('evil.example');
  });

  it('strips comments and non-svg children', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><!-- secret --><iframe src="https://evil.example"/><circle r="1"/></svg>`);
    expect(out).toBeTruthy();
    expect(out).not.toContain('secret');
    expect(out).not.toContain('iframe');
  });

  it('rejects non-SVG input, broken markup and empty input', () => {
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('<p>not svg</p>')).toBeNull();
    expect(sanitizeSvg('<svg><unclosed>')).toBeNull(); // not well-formed XML
    expect(sanitizeSvg('just text')).toBeNull();
    expect(sanitizeSvg('<div xmlns="http://www.w3.org/1999/xhtml">x</div>')).toBeNull();
  });

  it('rejects oversized input', () => {
    expect(sanitizeSvg('<svg>' + 'x'.repeat(200_001))).toBeNull();
  });

  it('scales viewBox graphics to their container', () => {
    const out = sanitizeSvg(ICON);
    expect(out).toBeTruthy();
    expect(parse(out!).getAttribute('width')).toBe('100%');
    const natural = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle r="1"/></svg>');
    expect(natural).toBeTruthy();
    expect(parse(natural!).getAttribute('width')).toBe('40'); // no viewBox → natural size kept
  });
});

describe('isSvgSource', () => {
  it('recognizes svg and xml fenced blocks that contain an svg root', () => {
    expect(isSvgSource('<svg><circle/></svg>', 'svg')).toBe(true);
    expect(isSvgSource('<svg xmlns="…"><circle/></svg>', 'xml')).toBe(true);
    expect(isSvgSource('<svg><circle/></svg>', undefined)).toBe(true);
    expect(isSvgSource('<svg><circle/></svg>', 'html')).toBe(false);
    expect(isSvgSource('<g><circle/></g>', 'svg')).toBe(false);
    expect(isSvgSource('const x = 1;', 'svg')).toBe(false);
  });
});
