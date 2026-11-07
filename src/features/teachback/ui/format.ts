/** Plain functions that turn an attempt into the words the panel shows. No React here. */
import { PASS_SCORE } from "@/shared/types";
import type { Attempt, Grade, IntegritySignals } from "@/shared/types";

/** The same limit the server enforces as MIN_EXPLANATION_WORDS. A test keeps them equal. */
export const MIN_WORDS = 15;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function wordCountMessage(words: number): string {
  if (words >= MIN_WORDS) return `${plural(words, "word")}. The ${MIN_WORDS}-word minimum is met.`;
  return `${plural(words, "word")}. ${MIN_WORDS - words} more to reach the ${MIN_WORDS}-word minimum.`;
}

export function metCount(grade: Grade): number {
  return grade.checkpoints.filter((checkpoint) => checkpoint.met).length;
}

/**
 * Shows how the score was reached, e.g. "2 of 3 checkpoints met, minus 20 for 1 factual error."
 *
 * While a follow-up is open the server sends only the met checkpoints and no errors, because the
 * question probes the rest. So the total comes from the skill, and the breakdown waits.
 */
export function scoreBreakdown(attempt: Attempt, checkpointTotal: number): string {
  const { grade } = attempt;
  const met = `${metCount(grade)} of ${plural(checkpointTotal, "checkpoint")} met`;
  if (attempt.status === "needs-followup") return `${met}. The full breakdown comes after your answer.`;

  const errors = grade.misconceptions.length;
  if (errors === 0) return `${met}.`;
  return `${met}, minus ${20 * errors} for ${plural(errors, "factual error")}.`;
}

/** True when the score passed but the learner did not pass the follow-up question. */
function failedFollowUp(attempt: Attempt): boolean {
  return attempt.followUp?.passed === false;
}

export function verdictTitle(attempt: Attempt): string {
  if (attempt.status === "proven") return "Proven";
  if (attempt.status === "needs-followup") return "Passing score. One question left.";
  if (failedFollowUp(attempt)) return "Not yet. That answer left a gap.";

  const missed = attempt.grade.checkpoints.length - metCount(attempt.grade);
  if (missed > 0) return `Not yet. ${plural(missed, "checkpoint")} to add.`;
  return "Not yet. One thing to correct.";
}

/** One specific sentence on what happens next. */
export function nextStepSentence(attempt: Attempt): string {
  if (attempt.status === "proven") return "Anything that needed this skill is now open.";
  if (attempt.status === "needs-followup") {
    return "Answer the question below about what you wrote, and this skill is proven.";
  }
  if (failedFollowUp(attempt)) {
    return "Strengthen that part of your explanation and check again. You will get a new question.";
  }

  const missed = attempt.grade.checkpoints.length - metCount(attempt.grade);
  const errors = attempt.grade.misconceptions.length;
  const fixes = [];
  if (missed > 0) fixes.push(`add the ${plural(missed, "missed checkpoint")}`);
  if (errors > 0) fixes.push(`correct ${plural(errors, "factual error")}`);
  return `To reach ${PASS_SCORE}, ${fixes.join(" and ")}. Your text is kept below for editing.`;
}

/** What the aria-live region says when a result arrives. */
export function resultAnnouncement(
  attempt: Attempt,
  skillTitle: string,
  checkpointTotal: number,
): string {
  const score = `Score ${attempt.grade.score} out of 100. ${scoreBreakdown(attempt, checkpointTotal)}`;
  if (attempt.status === "proven") return `${skillTitle} is proven. ${score}`;
  return `${verdictTitle(attempt)} ${score} ${nextStepSentence(attempt)}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return "under a second";
  if (seconds < 60) return plural(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? plural(minutes, "minute") : `${plural(minutes, "minute")} ${plural(rest, "second")}`;
}

/** The integrity signals as one calm sentence. */
export function integritySentence(integrity: IntegritySignals): string {
  const method = integrity.inputMethod === "voice" ? "Spoken" : "Typed";
  const activity = integrity.inputMethod === "voice" ? "speaking and typing" : "typing";
  const paste = integrity.pasted ? "includes pasted text" : "nothing pasted";
  return `${method}, ${plural(integrity.wordCount, "word")}, ${formatDuration(integrity.activeMs)} of active ${activity}, ${paste}.`;
}

/** Fallback for a prerequisite with no title given: "sql-joins" becomes "Sql joins". */
export function titleFromId(id: string): string {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
