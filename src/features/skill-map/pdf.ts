import { extractText, getDocumentProxy } from "unpdf";
import { SkillMapError } from "./build";
import { PAGE_BREAK } from "./validate";

/** Vercel refuses request bodies over 4.5 MB, so the limit sits under that. */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_PAGES = 30;
/** About 10 dense pages. More than this is too much for one map and one model call. */
export const MAX_PDF_CHARACTERS = 24_000;
/** Under this much text, the PDF is almost certainly a scan or photos of pages. */
const MIN_PDF_CHARACTERS = 80;

/** Reads the text of each page, or throws with a sentence the user can act on. */
export async function readPdfPages(bytes: Uint8Array): Promise<string[]> {
  if (bytes.length === 0) {
    throw new SkillMapError("That file is empty. Choose a PDF with some text in it.", 400);
  }
  if (bytes.length > MAX_PDF_BYTES) {
    throw new SkillMapError("That PDF is over 4 MB. Upload a smaller one, such as a single chapter.", 413);
  }

  let pages: string[];
  try {
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new SkillMapError(
        `That PDF has ${pdf.numPages} pages. Upload one with up to ${MAX_PDF_PAGES}, such as a single chapter.`,
        413,
      );
    }
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (error) {
    if (error instanceof SkillMapError) throw error;
    if (error instanceof Error && error.name === "PasswordException") {
      throw new SkillMapError("That PDF is password protected. Remove the password, then upload it again.", 422);
    }
    throw new SkillMapError("That file could not be read as a PDF. Check that it opens on your computer, then try again.", 422);
  }

  // The page break character must not appear inside a page, or the pages would split wrongly later.
  const cleaned = pages.map((page) => page.replaceAll(PAGE_BREAK, " ").trim());
  const characters = cleaned.join("").replace(/\s/g, "").length;

  if (characters < MIN_PDF_CHARACTERS) {
    throw new SkillMapError(
      "We could not find text in that PDF. It may be a scan or photos of pages. Upload a PDF where you can select the text, or paste the text as a posting instead.",
      422,
    );
  }
  if (cleaned.join(PAGE_BREAK).length > MAX_PDF_CHARACTERS) {
    throw new SkillMapError(
      "That PDF has too much text for one map. Upload a shorter part of it, such as one chapter of about 10 pages.",
      413,
    );
  }
  return cleaned;
}
