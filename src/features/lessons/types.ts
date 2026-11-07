/** A short reading lesson for one skill. Plain data: it is stored as JSON and sent to the browser. */
export type Lesson = {
  /** "The idea": 2 to 4 short paragraphs in plain words. */
  idea: string[];
  /** A worked example. `code` is null when the topic is not technical. */
  example: { intro: string; code: string | null; after: string };
  /** "Common mistakes": what people get wrong, and the fix. */
  mistakes: { mistake: string; fix: string }[];
  /** "Check yourself": exactly 2 questions, answers revealed on tap. */
  checks: { question: string; answer: string }[];
  /** Computed by code from the word count, at 200 words a minute. */
  readingMinutes: number;
};
