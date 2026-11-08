import type { ProgramLink, SkillMap } from "@/shared/types";
import {
  askModelForCourseMap,
  askModelForMap,
  askModelForPdfMap,
  askModelForTopicMap,
  buildSkillMap,
  checkPostingText,
  checkTopicText,
  topicReplyToRaw,
} from "./build";
import { cleanAudience, inferAudience } from "@/shared/audience";
import { findCachedOutput } from "./fixtures";
import { readPdfPages } from "./pdf";
import { rawTopicMapSchema, type CourseContext } from "./prompt";
import { saveSkillMap } from "./storage";
import { PAGE_BREAK } from "./validate";

/** Sets the audience on a map only when there is one, so a map for adults is saved as before. */
function withAudience(map: SkillMap, audience: string): SkillMap {
  return audience ? { ...map, audience } : map;
}

/**
 * Creates and saves a map from pasted posting text or a short topic. A sample posting
 * uses saved model output, so the demo keeps working if the AI providers are down.
 * Everything else goes to the model. A topic is pitched at `audience` (from the program
 * plan) or, without one, at the grade or age the topic plainly names. A posting is for adults.
 */
export async function generateSkillMap(input: {
  text: string;
  kind: "posting" | "topic";
  ownerId: string;
  audience?: string;
}): Promise<SkillMap> {
  let map: SkillMap;
  if (input.kind === "topic") {
    const topic = checkTopicText(input.text);
    const audience = cleanAudience(input.audience) || inferAudience(topic);
    map = withAudience(buildSkillMap(await askModelForTopicMap(topic, audience), topic, "topic", input.ownerId), audience);
  } else {
    const posting = checkPostingText(input.text);
    const raw = findCachedOutput(posting) ?? (await askModelForMap(posting));
    map = buildSkillMap(raw, posting, "posting", input.ownerId);
  }
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
  const map = withAudience(
    buildSkillMap(await askModelForPdfMap(pages, audience), pages.join(PAGE_BREAK), "pdf", input.ownerId),
    audience,
  );
  await saveSkillMap(map);
  return map;
}

/**
 * Builds one course of a program as a map, under the id the program reserved for it.
 * `cached` is saved model output for the sample program, so its demo needs no AI call.
 */
export async function generateCourseMap(input: {
  id: string;
  ownerId: string;
  course: CourseContext;
  program: ProgramLink;
  cached?: unknown;
}): Promise<SkillMap> {
  const raw = input.cached
    ? topicReplyToRaw(rawTopicMapSchema.parse(input.cached))
    : await askModelForCourseMap(input.course);
  const built = buildSkillMap(raw, input.course.courseTitle, "topic", input.ownerId);
  // The program page names the course, so the map keeps that name too. It inherits the program's audience.
  const map: SkillMap = withAudience(
    { ...built, id: input.id, title: input.course.courseTitle, program: input.program },
    cleanAudience(input.course.audience),
  );
  await saveSkillMap(map);
  return map;
}
