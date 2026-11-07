import { chatJSON } from "@/features/ai";
import type { SkillMap, SkillNode } from "@/shared/types";
import { buildLessonPrompt, LESSON_SYSTEM_PROMPT, rawLessonSchema, type RawLesson } from "./prompt";
import { lessonProblem } from "./validate";

/** Each request to a provider may take this long. Gemini writes 900 words in about 10 to 20 s. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * One model call for one skill's lesson. The checks run inside the schema, so a reply that is
 * too short or copies a checkpoint gets one retry with the reason, and then the next provider.
 * Gemini goes first because lessons are saved, so speed matters less than the writing.
 */
export async function askModelForLesson(map: Pick<SkillMap, "title">, node: SkillNode): Promise<RawLesson> {
  const schema = rawLessonSchema.superRefine((lesson, context) => {
    const problem = lessonProblem(lesson, node.checkpoints);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

  return chatJSON({
    label: "lesson",
    system: LESSON_SYSTEM_PROMPT,
    prompt: buildLessonPrompt(map, node),
    schema,
    maxTokens: 4000,
    timeoutMs: REQUEST_TIMEOUT_MS,
    preferredRoute: "gemini",
  });
}
