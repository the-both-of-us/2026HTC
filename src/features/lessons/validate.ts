import { isYoungAudience } from "@/shared/audience";
import { normalizeForMatch } from "@/shared/quote";
import { TARGET_WORDS, targetWords, type RawLesson, type WordTarget } from "./prompt";
import type { Lesson } from "./types";

/** Below this the lesson is too thin to be a 3 minute read (500 words rounds up to 3). The prompt asks for 600 to 900. */
export const MIN_WORDS = 500;

/**
 * The word limits a reply must meet for this target. The usual lesson has only a floor, as
 * before. A lesson for children also has a ceiling, since a long one loses a young reader.
 */
export function wordLimits(target: WordTarget): { min: number; max: number | null } {
  if (target === TARGET_WORDS) return { min: MIN_WORDS, max: null };
  return { min: Math.round(target.min * 0.75), max: target.max + 150 };
}
/** A run of this many checkpoint words, in order, counts as copying it. The prompt asks for fewer than 6. */
export const COPIED_RUN = 8;
const WORDS_PER_MINUTE = 200;

/** Lower case words, with punctuation dropped, so "SQL," and "sql" match. */
function wordsOf(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/[^a-z0-9'+#]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * The first checkpoint the text copies, or null. Copying means a run of COPIED_RUN of its
 * words in the same order, or all of a shorter checkpoint (4 words or more).
 */
export function copiedCheckpoint(text: string, checkpoints: string[]): string | null {
  const haystack = ` ${wordsOf(text).join(" ")} `;
  for (const checkpoint of checkpoints) {
    const words = wordsOf(checkpoint);
    if (words.length < 4) continue;
    const run = Math.min(COPIED_RUN, words.length);
    for (let start = 0; start + run <= words.length; start++) {
      if (haystack.includes(` ${words.slice(start, start + run).join(" ")} `)) return checkpoint;
    }
  }
  return null;
}

/** Every word a learner reads, in order. */
export function lessonText(lesson: RawLesson): string {
  return [
    ...lesson.idea,
    lesson.example.intro,
    lesson.example.code ?? "",
    lesson.example.after,
    ...lesson.mistakes.flatMap((item) => [item.mistake, item.fix]),
    ...lesson.checks.flatMap((item) => [item.question, item.answer]),
  ].join("\n");
}

const filled = (value: string) => value.trim() !== "";

/** What is wrong with a reply, in words the model can act on, or null if it is fine. `audience` is the map's. */
export function lessonProblem(lesson: RawLesson, checkpoints: string[], audience?: string): string | null {
  if (lesson.idea.filter(filled).length < 2) return "idea needs 2 to 4 paragraphs.";
  if (lesson.mistakes.filter((item) => filled(item.mistake) && filled(item.fix)).length < 2) {
    return "mistakes needs 3 items, each with a fix.";
  }
  if (lesson.checks.filter((item) => filled(item.question) && filled(item.answer)).length < 2) {
    return "checks needs exactly 2 questions, each with an answer.";
  }
  const target = targetWords(audience);
  const limits = wordLimits(target);
  const words = wordsOf(lessonText(lesson)).length;
  if (words < limits.min) return `it has ${words} words. Write ${target.min} to ${target.max}.`;
  if (limits.max !== null && words > limits.max) return `it has ${words} words, too long for these readers. Write ${target.min} to ${target.max}.`;
  if (isYoungAudience(audience) && filled(lesson.example.code ?? "")) return "code must be null for these readers. Use real objects instead.";
  const copied = copiedCheckpoint(lessonText(lesson), checkpoints);
  if (copied) return `it copies this checkpoint word for word: "${copied}". Teach it in your own words.`;
  return null;
}

/** Trims the reply and adds the reading time. Call only after lessonProblem returned null. */
export function toLesson(raw: RawLesson): Lesson {
  const code = raw.example.code?.replace(/^\n+|\s+$/g, "") ?? "";
  const lesson: Lesson = {
    idea: raw.idea.map((paragraph) => paragraph.trim()).filter(Boolean).slice(0, 5),
    example: { intro: raw.example.intro.trim(), code: code === "" ? null : code, after: raw.example.after.trim() },
    mistakes: raw.mistakes
      .map((item) => ({ mistake: item.mistake.trim(), fix: item.fix.trim() }))
      .filter((item) => item.mistake && item.fix)
      .slice(0, 4),
    checks: raw.checks
      .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
      .filter((item) => item.question && item.answer)
      .slice(0, 2),
    readingMinutes: 0,
  };
  lesson.readingMinutes = Math.max(1, Math.round(wordsOf(lessonText(lesson)).length / WORDS_PER_MINUTE));
  return lesson;
}
