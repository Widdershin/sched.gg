// Minimal PDF writer: assembles a document where each page shows one full-bleed
// JPEG image, embedded as-is via the DCTDecode filter (no re-encoding). This is
// just enough for the lanyard export — not a general-purpose PDF library.

export interface PdfPage {
  jpeg: Uint8Array; // JFIF/JPEG bytes (DeviceRGB, 8-bit) — drawn to fill the page
  pxW: number; // image pixel width
  pxH: number; // image pixel height
  ptW: number; // page width in PDF points (1/72 inch)
  ptH: number; // page height in PDF points
}

// Encode a string as Latin-1 bytes (PDF syntax is byte-oriented; all the markup
// we emit is ASCII, so one char = one byte).
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// Trim a number to at most 2 decimals (PDF points don't need more precision).
function num(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// Build a single-file PDF from full-bleed image pages. Object layout:
//   1: Catalog, 2: Pages, then per page i: page, content stream, image XObject.
export function imagesToPdf(pages: PdfPage[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = []; // offsets[objId] = byte offset of "<id> 0 obj"

  const push = (data: Uint8Array | string) => {
    const b = typeof data === "string" ? latin1(data) : data;
    chunks.push(b);
    offset += b.length;
  };
  const beginObj = (id: number) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
  };
  const endObj = () => push("endobj\n");

  const pageObjId = (i: number) => 3 + i * 3;
  const contentObjId = (i: number) => 4 + i * 3;
  const imageObjId = (i: number) => 5 + i * 3;
  const totalObjs = 2 + pages.length * 3;

  // Header — the binary-comment line tells tools the file contains binary data.
  push("%PDF-1.4\n");
  push("%\xFF\xFF\xFF\xFF\n");

  // Catalog
  beginObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObj();

  // Pages tree
  beginObj(2);
  const kids = pages.map((_, i) => `${pageObjId(i)} 0 R`).join(" ");
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\n`);
  endObj();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];

    beginObj(pageObjId(i));
    push(
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${num(p.ptW)} ${num(p.ptH)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjId(i)} 0 R >> >> ` +
        `/Contents ${contentObjId(i)} 0 R >>\n`,
    );
    endObj();

    // Content: scale the unit image space up to the full page, then draw it.
    const content = latin1(`q ${num(p.ptW)} 0 0 ${num(p.ptH)} 0 0 cm /Im0 Do Q\n`);
    beginObj(contentObjId(i));
    push(`<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push("\nendstream\n");
    endObj();

    beginObj(imageObjId(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${p.jpeg.length} >>\nstream\n`,
    );
    push(p.jpeg);
    push("\nendstream\n");
    endObj();
  }

  // Cross-reference table + trailer.
  const xrefOffset = offset;
  const size = totalObjs + 1; // +1 for the free object 0
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id <= totalObjs; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
