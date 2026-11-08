import { chatJSON, modelLabel, type Tier } from "@/features/ai";
import type { SkillMap, SkillNode } from "@/shared/types";
import { buildLessonPrompt, lessonSystemPrompt, rawLessonSchema, type RawLesson } from "./prompt";
import type { WrittenBy } from "./types";
import { lessonProblem } from "./validate";

/** Each request to a provider may take this long. Gemini writes 900 words in about 10 to 20 s. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Sonnet and Opus write more slowly, so their requests get longer. */
const SLOW_MODEL_TIMEOUT_MS = 50_000;

/**
 * One model call for one skill's lesson. The checks run inside the schema, so a reply that is
 * too short or copies a checkpoint gets one retry with the reason, and then the next provider.
 * Gemini goes first because lessons are saved, so speed matters less than the writing. A tier
 * above 1 (from the model router) puts a Claude model ahead of Gemini.
 */
export async function askModelForLesson(
  map: Pick<SkillMap, "title" | "audience">,
  node: SkillNode,
  tier?: Tier,
): Promise<{ raw: RawLesson; writtenBy?: WrittenBy }> {
  const schema = rawLessonSchema.superRefine((lesson, context) => {
    const problem = lessonProblem(lesson, node.checkpoints, map.audience);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

  let writtenBy: WrittenBy | undefined;
  const raw = await chatJSON({
    label: "lesson",
    system: lessonSystemPrompt(map.audience),
    prompt: buildLessonPrompt(map, node),
    schema,
    maxTokens: 4000,
    timeoutMs: tier && tier >= 3 ? SLOW_MODEL_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    preferredRoute: "gemini",
    tier,
    onServed: ({ model, ms }) => {
      writtenBy = { model: modelLabel(model), ms };
    },
  });
  return { raw, writtenBy };
}
