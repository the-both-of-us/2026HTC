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
import { findCachedOutput } from "./fixtures";
import { readPdfPages } from "./pdf";
import { rawTopicMapSchema, type CourseContext } from "./prompt";
import { saveSkillMap } from "./storage";
import { PAGE_BREAK } from "./validate";

/**
 * Creates and saves a map from pasted posting text or a short topic. A sample posting
 * uses saved model output, so the demo keeps working if the AI providers are down.
 * Everything else goes to the model.
 */
export async function generateSkillMap(input: {
  text: string;
  kind: "posting" | "topic";
  ownerId: string;
}): Promise<SkillMap> {
  let map: SkillMap;
  if (input.kind === "topic") {
    const topic = checkTopicText(input.text);
    map = buildSkillMap(await askModelForTopicMap(topic), topic, "topic", input.ownerId);
  } else {
    const posting = checkPostingText(input.text);
    const raw = findCachedOutput(posting) ?? (await askModelForMap(posting));
    map = buildSkillMap(raw, posting, "posting", input.ownerId);
  }
  await saveSkillMap(map);
  return map;
}

/** Creates and saves a map from a PDF file. Each page's text is kept, so citations name their page. */
export async function generatePdfSkillMap(input: { file: Uint8Array; ownerId: string }): Promise<SkillMap> {
  const pages = await readPdfPages(input.file);
  const map = buildSkillMap(await askModelForPdfMap(pages), pages.join(PAGE_BREAK), "pdf", input.ownerId);
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
  // The program page names the course, so the map keeps that name too.
  const map: SkillMap = { ...built, id: input.id, title: input.course.courseTitle, program: input.program };
  await saveSkillMap(map);
  return map;
}
