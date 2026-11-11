import { chatJSON } from "@/features/ai";
import { isYoungAudience } from "@/shared/audience";
import { buildCheckPrompt, checkReplySchema, CHECK_SYSTEM, YOUNG_NOTE, type CheckItem } from "./prompt";
import type { PretestOutcome, PretestQuestion } from "./types";

/** One unit's check: the check profile, 2k tokens and 15 s. */
export const CHECK_MAX_TOKENS = 2_000;
export const CHECK_TOTAL_MS = 15_000;

/** Most characters one answer may have. */
export const MAX_PRETEST_ANSWER_CHARACTERS = 1_000;

/** Answers that say "I don't know" in so many words. They count as skipped, like an empty one. */
const DONT_KNOW =
  /^(i\s*(do\s*not|don'?t|dont|have\s*no)\s*(know|idea|remember)|i'?m\s*not\s*sure|not\s*sure|no\s*idea|idk|dunno|unsure|pass|skip|n\/?a|none|no|nothing|\?+|-+|\.+)[\s.!?]*$/i;

/** The answer as the learner gave it, before any model sees it. */
export type GivenAnswer = { answer?: string | null; dontKnow?: boolean };

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Decided by code alone: "skipped" for no answer, an empty one, "I don't know" (ticked or typed);
 * "missed" for an answer that only repeats the question; null when the model must check it.
 */
export function classifyAnswer(question: string, given: GivenAnswer | undefined): Exclude<PretestOutcome, "known"> | null {
  if (!given || given.dontKnow) return "skipped";
  const text = (given.answer ?? "").trim();
  if (text === "" || DONT_KNOW.test(text)) return "skipped";
  const words = normalize(text);
  if (words === "" || normalize(question).includes(words)) return "missed";
  return null;
}

/**
 * Grades one unit's answers with at most one check call. Only answers code could not decide are
 * sent, numbered; the model returns a verdict per item, and code makes the result: an item is
 * "known" only when the model returned `correct: true` for it and never `false`. A missing item,
 * or any reply that cannot be read, is "missed". Empty and "I don't know" answers never reach
 * the model and never pass. Throws AiUnavailableError when the call fails, recording nothing.
 */
export async function gradeUnit(
  questions: PretestQuestion[],
  answers: Map<string, GivenAnswer>,
  audience = "",
): Promise<{ topicId: string; outcome: PretestOutcome }[]> {
  const outcomes = new Map<string, PretestOutcome>();
  const toCheck: { topicId: string; item: CheckItem }[] = [];
  for (const question of questions) {
    const given = answers.get(question.topicId);
    const decided = classifyAnswer(question.question, given);
    if (decided) outcomes.set(question.topicId, decided);
    else toCheck.push({ topicId: question.topicId, item: { question: question.question, keyPoints: question.keyPoints, answer: (given?.answer ?? "").trim() } });
  }

  if (toCheck.length > 0) {
    const reply = await chatJSON({
      profile: "check",
      label: "pretest-grade",
      // The childlike-wording note only for a young audience; "university students" get the plain bar.
      system: audience ? `${CHECK_SYSTEM}\n\nTHE LEARNERS\nThey are: ${audience}.${isYoungAudience(audience) ? ` ${YOUNG_NOTE}` : ""}` : CHECK_SYSTEM,
      prompt: buildCheckPrompt(toCheck.map(({ item }) => item)),
      schema: checkReplySchema,
      maxTokens: CHECK_MAX_TOKENS,
      totalMs: CHECK_TOTAL_MS,
    });
    toCheck.forEach(({ topicId }, index) => {
      const verdicts = reply.verdicts.filter((verdict) => verdict.item === index + 1);
      const known = verdicts.length > 0 && verdicts.every((verdict) => verdict.correct === true);
      outcomes.set(topicId, known ? "known" : "missed");
    });
  }

  return questions.map((question) => ({ topicId: question.topicId, outcome: outcomes.get(question.topicId) ?? "skipped" }));
}
