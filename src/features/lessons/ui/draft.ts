import type { Lesson, LessonPart, PracticeCase } from "../types";

/** A lesson as the Read tab draws it: complete, or only the parts written so far. Parts keep their order. */
export type LessonDraft = {
  idea: string[];
  example: Lesson["example"] | null;
  mistakes: Lesson["mistakes"];
  checks: Lesson["checks"];
  practice: PracticeCase[];
};

/** Gathers streamed parts by kind. Within a kind the order is the order written. */
export function draftOfParts(parts: readonly LessonPart[]): LessonDraft {
  const draft: LessonDraft = { idea: [], example: null, mistakes: [], checks: [], practice: [] };
  for (const part of parts) {
    if (part.part === "idea") draft.idea.push(part.text);
    else if (part.part === "example") draft.example = { intro: part.intro, code: part.code, after: part.after };
    else if (part.part === "mistake") draft.mistakes.push({ mistake: part.mistake, fix: part.fix });
    else if (part.part === "check") draft.checks.push({ question: part.question, answer: part.answer });
    else draft.practice.push({ scenario: part.scenario, question: part.question });
  }
  return draft;
}

export function draftOfLesson(lesson: Lesson): LessonDraft {
  return {
    idea: lesson.idea,
    example: lesson.example,
    mistakes: lesson.mistakes,
    checks: lesson.checks,
    practice: lesson.practice ?? [],
  };
}
