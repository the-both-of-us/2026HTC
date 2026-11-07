import type { SkillMap } from "@/shared/types";
import {
  askModelForMap,
  askModelForPdfMap,
  askModelForTopicMap,
  buildSkillMap,
  checkPostingText,
  checkTopicText,
} from "./build";
import { findCachedOutput } from "./fixtures";
import { readPdfPages } from "./pdf";
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
