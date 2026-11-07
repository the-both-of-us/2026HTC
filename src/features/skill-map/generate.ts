import type { SkillMap } from "@/shared/types";
import { askModelForMap, buildSkillMap, checkPostingText } from "./build";
import { findCachedOutput } from "./fixtures";
import { saveSkillMap } from "./storage";

/**
 * Creates and saves a map. A sample posting uses saved model output, so the demo
 * keeps working if the AI providers are down. Everything else goes to the model.
 */
export async function generateSkillMap(input: {
  text: string;
  kind: "posting";
  ownerId: string;
}): Promise<SkillMap> {
  const posting = checkPostingText(input.text);
  const raw = findCachedOutput(posting) ?? (await askModelForMap(posting));
  const map = buildSkillMap(raw, posting, input.kind, input.ownerId);

  await saveSkillMap(map);
  return map;
}
