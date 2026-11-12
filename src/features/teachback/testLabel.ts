/**
 * How a finished unit test or final test is labelled wherever it is shown: honest about its
 * format and with its score. Plain code with no server imports, for screens and server alike.
 */

/** The fields of a test result a label needs (a `FinalResult` has them all). */
export type TestScore = {
  passedCount: number;
  /** "multiple-choice" on results since Nov 12. Absent on an older written result. */
  format?: "multiple-choice";
  questionCount?: number;
};

/**
 * "5 of 6, multiple choice", or for a record from before Nov 12 "2 of 3, written answers".
 * `fallbackCount` is the question count when an older result does not carry one.
 */
export function testScoreLabel(result: TestScore, fallbackCount?: number): string {
  const total = result.questionCount ?? fallbackCount;
  const score = total === undefined ? `${result.passedCount} passed` : `${result.passedCount} of ${total}`;
  return `${score}, ${result.format === "multiple-choice" ? "multiple choice" : "written answers"}`;
}
