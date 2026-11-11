import type { SkillMap } from "@/shared/types";
import { askModelForMap, askModelForPdfMap, buildSkillMap, checkPostingText } from "./build";
import { inferAudience } from "@/shared/audience";
import { findCachedOutput } from "./fixtures";
import { readPdfPages } from "./pdf";
import { saveSkillMap } from "./storage";
import { PAGE_BREAK } from "./validate";

/*
 * Private maps from a source: a job posting or a PDF. They are never in the catalog: their
 * content is keyed by the map id (`contentIdOf(map)` = `map.id`). Topics are catalog courses,
 * built from a syllabus by programs and syllabus, never here.
 */

/** Sets the audience on a map only when there is one, so a map for adults is saved as before. */
function withAudience(map: SkillMap, audience: string): SkillMap {
  return audience ? { ...map, audience } : map;
}

/**
 * Creates and saves a map from pasted posting text. A sample posting uses saved model output, so
 * the demo keeps working if the AI is down. Everything else is one model call (plan profile).
 */
export async function generateSkillMap(input: { text: string; kind?: "posting"; ownerId: string }): Promise<SkillMap> {
  const posting = checkPostingText(input.text);
  const raw = findCachedOutput(posting) ?? (await askModelForMap(posting));
  const map = buildSkillMap(raw, posting, "posting", input.ownerId);
  await saveSkillMap(map);
  return map;
}

/** How much of a PDF's first page is read for a grade or age, such as a worksheet's heading. */
const AUDIENCE_SCAN_CHARS = 600;

/** Creates and saves a map from a PDF file. Each page's text is kept, so citations name their page. */
export async function generatePdfSkillMap(input: { file: Uint8Array; ownerId: string }): Promise<SkillMap> {
  const pages = await readPdfPages(input.file);
  // Only the start of the document: a grade named there is what the document is for.
  const audience = inferAudience((pages[0] ?? "").slice(0, AUDIENCE_SCAN_CHARS));
  const raw = await askModelForPdfMap(pages, audience);
  const map = withAudience(buildSkillMap(raw, pages.join(PAGE_BREAK), "pdf", input.ownerId), audience);
  await saveSkillMap(map);
  return map;
}
