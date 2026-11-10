/**
 * Teach-back pitched at a map's audience, such as "Grade 1 students (about 6 years old)".
 * With no audience every prompt is returned exactly as written, so adults are graded as before.
 */

/** Adds a section about the learner to a system prompt, or returns it unchanged when there is no audience. */
export function forAudience(system: string, audience: string | undefined, note: string): string {
  if (!audience) return system;
  return `${system}

THE LEARNER
The learner is: ${audience}. ${note}`;
}

export const GRADER_NOTE = `Expect short, simple, childlike words. Credit a checkpoint when its plain idea is clearly stated in their own words, even without the checkpoint's terms: for "Each thing gets counted exactly once", the words "you count each thing once and don't skip any" count. Accuracy still matters: return null when the idea is missing, unclear or wrong. Simple wording, spelling, grammar or a missing term is never a factual error.`;

export const CHECKER_NOTE = "Simple, childlike or misspelled wording is never an error. Only a claim that is really false counts.";

export const QUESTION_NOTE =
  "Ask in short, everyday words they know, at most 20 words, about something they can picture, such as toys, food or their day.";

export const ANSWER_NOTE =
  "Short, simple, childlike answers are fine when what they say is correct. Write the feedback in short, simple words they can read.";

export const CATCH_WRITER_NOTE =
  "Use short sentences and words they know. Plant mistakes they can spot at their level, such as a wrong count, a wrong number of sides or a wrong order, never a trick about terms.";

export const FINAL_QUESTIONS_NOTE =
  "Ask in short, everyday words they know, at most 20 words each, about a small situation they can picture.";
