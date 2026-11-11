import { isYoungAudience } from "@/shared/audience";
import { normalizeForMatch } from "@/shared/quote";
import { SYLLABUS_SHAPE, type ProgramDepth } from "@/shared/types";
import { TARGET_WORDS, targetWords, wantsPractice, type RawLesson, type WordTarget } from "./prompt";
import type { Lesson, LessonLine, LessonPart } from "./types";

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
export function wordsOf(text: string): string[] {
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

/** A model reply or a finished lesson: both have the parts a learner reads. Only a reply has model answers. */
type LessonLike = Pick<RawLesson, "idea" | "example" | "mistakes" | "checks"> & {
  practice?: { scenario: string; question: string; modelAnswer?: string }[];
};

/** Every word a learner reads, in order. A practice case's model answer is not one of them: they never see it. */
export function lessonText(lesson: LessonLike): string {
  return [
    ...lesson.idea,
    lesson.example.intro,
    lesson.example.code ?? "",
    lesson.example.after,
    ...lesson.mistakes.flatMap((item) => [item.mistake, item.fix]),
    ...lesson.checks.flatMap((item) => [item.question, item.answer]),
    ...(lesson.practice ?? []).flatMap((item) => [item.scenario, item.question]),
  ].join("\n");
}

const filled = (value: string) => value.trim() !== "";

/**
 * What is wrong with a reply, in words the model can act on, or null if it is fine. `audience` is
 * the map's, and `depth` its syllabus depth: a degree lesson is longer and has practice cases.
 */
export function lessonProblem(lesson: LessonLike, checkpoints: string[], audience?: string, depth?: ProgramDepth): string | null {
  if (lesson.idea.filter(filled).length < 2) return "idea needs 2 to 4 paragraphs.";
  if (lesson.mistakes.filter((item) => filled(item.mistake) && filled(item.fix)).length < 2) {
    return "mistakes needs 3 items, each with a fix.";
  }
  if (lesson.checks.filter((item) => filled(item.question) && filled(item.answer)).length < 2) {
    return "checks needs exactly 2 questions, each with an answer.";
  }
  if (wantsPractice(audience, depth)) {
    const cases = (lesson.practice ?? []).filter((item) => filled(item.scenario) && filled(item.question) && filled(item.modelAnswer ?? ""));
    const wanted = SYLLABUS_SHAPE.degree.practiceCases;
    if (cases.length !== wanted) return `practice needs exactly ${wanted} cases, each with a scenario, a question and a modelAnswer.`;
  }
  const target = targetWords(audience, depth);
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
    ...(raw.practice && { practice: practiceCases(raw) }),
  };
  lesson.readingMinutes = Math.max(1, Math.round(wordsOf(lessonText(lesson)).length / WORDS_PER_MINUTE));
  return lesson;
}

/** The practice cases a learner sees: scenario and question only. */
function practiceCases(raw: RawLesson) {
  return (raw.practice ?? [])
    .filter((item) => filled(item.scenario) && filled(item.question))
    .slice(0, SYLLABUS_SHAPE.degree.practiceCases)
    .map((item) => ({ scenario: item.scenario.trim(), question: item.question.trim() }));
}

/**
 * The model answers for a lesson's practice cases, in the same order as `lesson.practice`.
 * They are stored beside the lesson and never put on a `Lesson`, so they never reach a browser.
 */
export function practiceAnswersOf(raw: RawLesson): string[] {
  return (raw.practice ?? [])
    .filter((item) => filled(item.scenario) && filled(item.question))
    .slice(0, SYLLABUS_SHAPE.degree.practiceCases)
    .map((item) => item.modelAnswer.trim());
}

/*
 * Wave 2: lesson lines. Each line is checked as it arrives, and the lines are assembled into the
 * same lesson shape as before, so `lessonProblem` and `toLesson` still decide what is saved.
 */

/** How many of each part a lesson keeps; a line past these is dropped (never shown). */
export const PART_LIMITS: Record<LessonLine["part"], number> = {
  idea: 4,
  example: 1,
  mistake: 3,
  check: 2,
  practice: SYLLABUS_SHAPE.degree.practiceCases,
};

/** The words of a line a learner reads. A practice line's model answer is not one of them. */
export function lineText(line: LessonLine): string {
  switch (line.part) {
    case "idea":
      return line.text;
    case "example":
      return [line.intro, line.code ?? "", line.after].join("\n");
    case "mistake":
      return `${line.mistake}\n${line.fix}`;
    case "check":
      return `${line.question}\n${line.answer}`;
    case "practice":
      return `${line.scenario}\n${line.question}`;
  }
}

/** Trims a line. A young audience's example has no code. */
export function cleanLine(line: LessonLine, audience?: string): LessonLine {
  switch (line.part) {
    case "idea":
      return { part: "idea", text: line.text.trim() };
    case "example": {
      const code = line.code?.replace(/^\n+|\s+$/g, "") ?? "";
      return {
        part: "example",
        intro: line.intro.trim(),
        code: code === "" || isYoungAudience(audience) ? null : code,
        after: line.after.trim(),
      };
    }
    case "mistake":
      return { part: "mistake", mistake: line.mistake.trim(), fix: line.fix.trim() };
    case "check":
      return { part: "check", question: line.question.trim(), answer: line.answer.trim() };
    case "practice":
      return { part: "practice", scenario: line.scenario.trim(), question: line.question.trim(), modelAnswer: line.modelAnswer.trim() };
  }
}

/**
 * Why a single line may not be shown, in words the model can act on, or null. A line that copies a
 * checkpoint (the answer key) or leaves a field empty is rejected and never reaches a learner.
 */
export function lineProblem(line: LessonLine, checkpoints: string[]): string | null {
  if (line.part === "practice" && !filled(line.modelAnswer)) return "a practice line had no modelAnswer.";
  // The fields themselves, never the text split on "\n": an idea may hold a list or a tip after a blank line.
  if (requiredFields(line).some((field) => !filled(field))) return `a ${line.part} line had an empty field.`;
  const copied = copiedCheckpoint(lineText(line), checkpoints);
  if (copied) return `a ${line.part} line copied this checkpoint word for word: "${copied}". Teach it in your own words.`;
  return null;
}

/** The fields a line must fill. An example's code may be null. */
function requiredFields(line: LessonLine): string[] {
  switch (line.part) {
    case "idea":
      return [line.text];
    case "example":
      return [line.intro, line.after];
    case "mistake":
      return [line.mistake, line.fix];
    case "check":
      return [line.question, line.answer];
    case "practice":
      return [line.scenario, line.question];
  }
}

/** A list item or the tip callout: it belongs to the paragraph before it, not a paragraph of its own. */
const CONTINUES = /^\s*(?:[-*•]\s|\d+[.)]\s|>)/;

/**
 * An idea line that holds several paragraphs (separated by a blank line) as one idea line per
 * paragraph, so the 2-to-4 paragraph rule counts paragraphs, not lines. A list or a "> Tip:" after
 * a blank line stays with its paragraph. Any other line is returned as it is.
 */
export function splitIdeaParagraphs(line: LessonLine): LessonLine[] {
  if (line.part !== "idea") return [line];
  const paragraphs: string[] = [];
  for (const chunk of line.text.split(/\n[ \t]*\n/).map((part) => part.trim()).filter(Boolean)) {
    if (paragraphs.length > 0 && CONTINUES.test(chunk)) paragraphs[paragraphs.length - 1] += `\n${chunk}`;
    else paragraphs.push(chunk);
  }
  if (paragraphs.length <= 1) return [line];
  return paragraphs.map((text) => ({ part: "idea", text }));
}

/** The lines as the lesson shape `lessonProblem` and `toLesson` work on, or null with no example. */
export function assembleLesson(lines: LessonLine[], withPractice: boolean): RawLesson | null {
  const example = lines.find((line) => line.part === "example");
  if (!example) return null;
  const raw: RawLesson = {
    idea: lines.flatMap((line) => (line.part === "idea" ? [line.text] : [])),
    example: { intro: example.intro, code: example.code, after: example.after },
    mistakes: lines.flatMap((line) => (line.part === "mistake" ? [{ mistake: line.mistake, fix: line.fix }] : [])),
    checks: lines.flatMap((line) => (line.part === "check" ? [{ question: line.question, answer: line.answer }] : [])),
  };
  if (withPractice) {
    raw.practice = lines.flatMap((line) =>
      line.part === "practice" ? [{ scenario: line.scenario, question: line.question, modelAnswer: line.modelAnswer }] : [],
    );
  }
  return raw;
}

/** A line as a browser may see it: a practice line loses its model answer. */
export function toPublicPart(line: LessonLine): LessonPart {
  if (line.part !== "practice") return line;
  return { part: "practice", scenario: line.scenario, question: line.question };
}
