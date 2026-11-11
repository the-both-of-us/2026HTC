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
  /**
   * Degree lessons only: 2 situations to reason about. The model answers are not here. They are
   * kept on the server (see `practiceAnswersOf`) and used to check what the learner writes.
   */
  practice?: PracticeCase[];
  /** Computed by code from the word count, at 200 words a minute. */
  readingMinutes: number;
  /** Which model wrote it and how long that took. Absent on sample lessons and ones saved before this existed. */
  writtenBy?: WrittenBy;
};

/** "Claude Sonnet" or "gpt-oss-120b", and the milliseconds the model call took. */
export type WrittenBy = { model: string; ms: number };

/** One practice case as the browser sees it: no model answer. */
export type PracticeCase = { scenario: string; question: string };

/** What checking a practice answer returns. Only a verdict and a sentence: never the model answer. */
export type PracticeFeedback = { verdict: "solid" | "partly" | "off"; feedback: string };

/*
 * Wave 2: progressive lessons. A lesson is written once per canonical course and node
 * (`lessons/<contentIdOf(map)>/<nodeId>[/<aud>]`, guarded by `startOnce`), as JSON lines that
 * are shown as they arrive.
 */

/**
 * One line of a lesson as the model writes it and the partial doc stores it, in this order:
 * idea x2-4, example, mistake x3, check x2, then practice x2 (degree lessons for older readers).
 * Server only: `practice.modelAnswer` is the answer key and never reaches a browser.
 */
export type LessonLine =
  | { part: "idea"; text: string }
  | { part: "example"; intro: string; code: string | null; after: string }
  | { part: "mistake"; mistake: string; fix: string }
  | { part: "check"; question: string; answer: string }
  | { part: "practice"; scenario: string; question: string; modelAnswer: string };

/** A lesson line as a browser gets it: practice parts without `modelAnswer`. */
export type LessonPart = Exclude<LessonLine, { part: "practice" }> | ({ part: "practice" } & PracticeCase);

/** `POST /api/lessons` body (unchanged). */
export type LessonRequest = { mapId: string; nodeId: string };

/**
 * `POST /api/lessons` reply 200. `{ lesson }` once the lesson is final. Otherwise
 * `{ status: "writing", attempt, parts }`: the parts written so far (the POST starts the writer
 * if nobody is writing). The Read tab renders the parts in order with "Writing…" under the last,
 * and POSTs again every 1.5 s. When `attempt` goes up, the parts are a rewrite: swap them in under
 * "Improving this lesson…". 503 `{ error }` when the rewrite also failed (a sentence with a retry).
 * A private map is a 404 for strangers, as before.
 */
export type LessonResponse = { lesson: Lesson } | { status: "writing"; attempt: number; parts: LessonPart[] };
