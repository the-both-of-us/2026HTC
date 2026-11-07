/**
 * Writes a small, real PDF with one page per string, using the built-in Helvetica font.
 * Tests use it so the PDF reader runs on real files, not mocks. Each line of a page
 * string becomes a line of text on that page. ASCII only, which is all the tests need.
 */
export function makeTextPdf(pages: string[]): Uint8Array {
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  pages.forEach((text, index) => {
    const lines = text.split("\n").map((line, row) => {
      const escaped = line.replace(/[\\()]/g, (char) => `\\${char}`);
      return `BT /F1 12 Tf 50 ${750 - row * 16} Td (${escaped}) Tj ET`;
    });
    const stream = lines.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  // The cross-reference table lists where each object starts, in bytes.
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}
