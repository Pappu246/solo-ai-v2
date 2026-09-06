/**
 * A real, one-page PDF with a Helvetica text stream, byte-accurate xref table
 * and trailer. Optional padding lives in an unused stream (not after EOF),
 * so the large-upload fixture is still a valid PDF. Generate bytes at runtime
 * rather than checking a multi-megabyte binary into Git.
 */
export function buildPdf(text: string, targetBytes = 0): Buffer {
  if (/[^\x20-\x7e]/.test(text)) throw new Error('PDF fixture text must be printable ASCII.');
  const escaped = text.replace(/[\\()]/g, '\\$&');
  const content = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;

  const serialize = (padding: number): Buffer => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
      `<< /Length ${String(padding).padStart(10, '0')} >>\nstream\n${' '.repeat(padding)}\nendstream`,
    ];
    let body = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, i) => {
      offsets.push(Buffer.byteLength(body));
      body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(body);
    body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    // Fixed-width numbers keep the overhead constant when padding is added.
    body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${String(xref).padStart(10, '0')}\n%%EOF\n`;
    return Buffer.from(body, 'ascii');
  };

  const small = serialize(0);
  return targetBytes > small.length ? serialize(targetBytes - small.length) : small;
}
