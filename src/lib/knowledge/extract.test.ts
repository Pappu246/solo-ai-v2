import { describe, it, expect } from 'vitest';
import { describePdfError, ExtractionError } from './extract';

describe('describePdfError', () => {
  it.each([
    {
      kind: 'password exception (including its name)',
      error: { name: 'PasswordException', message: 'No password given' },
      summary: /password-protected/,
      detail: 'PasswordException: No password given',
    },
    {
      kind: 'encrypted document',
      error: new Error('The document is encrypted.'),
      summary: /password-protected/,
      detail: 'The document is encrypted.',
    },
    {
      kind: 'worker bootstrap',
      error: new Error('Setting up fake worker failed: Failed to fetch dynamically imported module: /assets/pdf.worker.min-abc.mjs'),
      summary: /PDF reader could not start/,
      detail: 'Setting up fake worker failed: Failed to fetch dynamically imported module: /assets/pdf.worker.min-abc.mjs',
    },
    {
      kind: 'module MIME configuration',
      error: new Error('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html.'),
      summary: /PDF reader could not start/,
      detail: 'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html.',
    },
    {
      kind: 'CSP security exception',
      error: new DOMException('Refused by Content Security Policy.', 'SecurityError'),
      summary: /PDF reader could not start/,
      detail: 'SecurityError: Refused by Content Security Policy.',
    },
    {
      kind: 'chunk loading',
      error: { name: 'ChunkLoadError', message: 'Loading chunk 42 failed.' },
      summary: /PDF reader could not start/,
      detail: 'ChunkLoadError: Loading chunk 42 failed.',
    },
    {
      kind: 'corrupt PDF',
      error: { name: 'InvalidPDFException', message: 'Invalid PDF structure.' },
      summary: /invalid or corrupted/,
      detail: 'InvalidPDFException: Invalid PDF structure.',
    },
    {
      kind: 'PDF format exception',
      error: { name: 'FormatError', message: 'Bad XRef entry.' },
      summary: /invalid or corrupted/,
      detail: 'FormatError: Bad XRef entry.',
    },
    {
      kind: 'zero-byte PDF (not corruption despite InvalidPDFException)',
      error: { name: 'InvalidPDFException', message: 'The PDF file is empty, i.e. its size is zero bytes.' },
      summary: /No readable text/,
      detail: 'InvalidPDFException: The PDF file is empty, i.e. its size is zero bytes.',
    },
    {
      kind: 'scanned PDF without a text layer',
      error: new ExtractionError('The PDF contains no readable text.'),
      summary: /scanned \(images only\)/,
      detail: 'ExtractionError: The PDF contains no readable text.',
    },
    {
      kind: 'unexpected page extraction failure',
      error: new Error('Unexpected text content failure: font table missing.'),
      summary: /PDF could not be processed/,
      detail: 'Unexpected text content failure: font table missing.',
    },
    {
      kind: 'thrown string',
      error: 'An unusual PDF failure with diagnostic 123.',
      summary: /PDF could not be processed/,
      detail: 'An unusual PDF failure with diagnostic 123.',
    },
  ])('classifies $kind and preserves the original detail', ({ error, summary, detail }) => {
    const message = describePdfError(error);
    expect(message).toMatch(summary);
    expect(message).toContain(`Details: ${detail}`);
    if (!/invalid or corrupted/.test(message)) expect(message).not.toContain('may be corrupted');
  });

  it.each([undefined, null, {}, new Error()])('handles missing error details (%s) without inventing corruption', error => {
    expect(describePdfError(error)).toBe('This PDF could not be processed.');
  });

  it('preserves both worker and main-thread fallback diagnostics without truncation', () => {
    const detail = `PDF worker startup failed: Refused by CSP. Main-thread fallback failed: Failed to fetch dynamically imported module: /assets/${'a'.repeat(350)}.mjs`;
    expect(describePdfError(new Error(detail))).toContain(`Details: ${detail}`);
    expect(describePdfError(new Error(detail))).not.toContain('corrupted');
  });
});
