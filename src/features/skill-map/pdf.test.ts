import { describe, expect, it } from "vitest";
import { makeTextPdf } from "./fixtures/makePdf";
import { MAX_PDF_PAGES, readPdfPages } from "./pdf";

const NOTES = "Week 1. Relational tables, primary keys and foreign keys keep data consistent.";

async function errorOf(bytes: Uint8Array): Promise<{ status: number; message: string } | null> {
  try {
    await readPdfPages(bytes);
    return null;
  } catch (error) {
    const { status, message } = error as { status: number; message: string };
    return { status, message };
  }
}

describe("readPdfPages, on real PDF files", () => {
  it("returns the text of each page, in order", async () => {
    const pages = await readPdfPages(makeTextPdf([NOTES, "Week 2. SQL joins (inner and left)\nWindow functions"]));
    expect(pages).toEqual([NOTES, "Week 2. SQL joins (inner and left)\nWindow functions"]);
  });
  it("says a PDF with no text may be a scan", async () => {
    expect((await errorOf(makeTextPdf(["", " "])))?.message).toMatch(/scan/);
  });
  it("refuses a file that is not a PDF, and an empty file", async () => {
    expect(await errorOf(new TextEncoder().encode("Just some words, not a PDF at all."))).toMatchObject({ status: 422 });
    expect(await errorOf(new Uint8Array())).toMatchObject({ status: 400 });
  });
  it("refuses too many pages and too much text, with the limit in words", async () => {
    const many = await errorOf(makeTextPdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => NOTES)));
    expect(many).toMatchObject({ status: 413, message: expect.stringContaining(`${MAX_PDF_PAGES + 1} pages`) });

    const longPage = Array.from({ length: 50 }, () => NOTES).join("\n");
    expect(await errorOf(makeTextPdf(Array.from({ length: 10 }, () => longPage)))).toMatchObject({ status: 413 });
  });
  it("removes the page break character from page text, so pages split cleanly later", async () => {
    const [page] = await readPdfPages(makeTextPdf([`${NOTES} \f more text after a form feed.`]));
    expect(page).not.toContain("\f");
  });
});
