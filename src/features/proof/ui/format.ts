/** Plain functions that turn evidence into the words and pieces the page shows. No React here. */
import type { IntegritySignals, SourceKind } from "@/shared/types";
import type { ProofSkill, ProofSource } from "../types";

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** UTC, so the same record reads the same in every time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "UTC" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "UTC" }).format(date);
  return `${day}, ${time} UTC`;
}

export function formatDuration(ms: number): string | null {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** The four signals in calm words. They describe how the answer was written, nothing more. */
export function integrityLines(signals: IntegritySignals): {
  method: string;
  paste: string;
  active: string;
  words: string;
} {
  const active = formatDuration(signals.activeMs);
  return {
    method: signals.inputMethod === "voice" ? "Spoken" : "Typed",
    paste: signals.pasted ? "Some text was pasted" : "No paste detected",
    active: active ? `${active} active` : "Active time not recorded",
    words: plural(signals.wordCount, "word"),
  };
}

/**
 * How the follow-up was answered, e.g. "Answered aloud, 9 s after the question appeared".
 * Null for records saved before this was recorded, so the page says nothing rather than guess.
 */
export function followUpMethodLine(followUp: ProofSkill["followUp"]): string | null {
  if (!followUp.inputMethod) return null;
  const method = followUp.inputMethod === "voice" ? "Answered aloud" : "Typed";
  if (followUp.startedAfterMs === undefined) return method;
  const wait = formatDuration(followUp.startedAfterMs);
  return wait ? `${method}, began ${wait} after the question appeared` : `${method}, began right after the question appeared`;
}

export function metCount(skill: ProofSkill): number {
  return skill.checkpoints.filter((result) => result.met).length;
}

/** e.g. "2 of 3 checkpoints met, minus 20 for 1 factual error." */
export function scoreLine(skill: ProofSkill): string {
  const met = `${metCount(skill)} of ${plural(skill.checkpoints.length, "checkpoint")} met`;
  const errors = skill.factualErrors.length;
  if (errors === 0) return `${met}.`;
  return `${met}, minus ${20 * errors} for ${plural(errors, "factual error")}.`;
}

export function sourceName(source: Extract<ProofSource, { status: "verified" }>): string {
  if (source.kind === "posting") return "From the posting this person supplied";
  if (source.kind === "pdf") {
    return source.page === null ? "From the PDF this person supplied" : `From the PDF this person supplied, page ${source.page}`;
  }
  return "From the source this person supplied";
}

/** Says the role came from what the person supplied, so it can't read as an employer's own record. */
export function roleLead(sourceKind: SourceKind): string {
  if (sourceKind === "pdf") return "Skills evidence for a PDF this person supplied:";
  if (sourceKind === "topic") return "Skills evidence for a topic this person named, mapped by AI:";
  return "Skills evidence for a posting this person supplied:";
}

export type TextSegment = {
  text: string;
  marked: boolean;
  /** Checkpoint numbers whose quote finishes at the end of this piece. */
  endsCheckpoints: number[];
};

/**
 * Splits a person's text into plain and highlighted pieces, one highlight per quote.
 * Quotes match the way grading checks them: ignoring case and differences in whitespace.
 * `quotes` lines up with the checkpoints, so index 0 is checkpoint 1.
 */
export function highlightSegments(text: string, quotes: (string | null)[]): TextSegment[] {
  const ranges = quotes.flatMap((quote, index) => {
    const range = quote ? findQuote(text, quote) : null;
    return range ? [{ ...range, number: index + 1 }] : [];
  });

  const cuts = [...new Set([0, text.length, ...ranges.flatMap((range) => [range.start, range.end])])].sort(
    (a, b) => a - b,
  );

  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1];
    return {
      text: text.slice(start, end),
      marked: ranges.some((range) => range.start <= start && range.end >= end),
      endsCheckpoints: ranges.filter((range) => range.end === end).map((range) => range.number),
    };
  });
}

function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map(escapeForRegExp);
  if (words.length === 0) return null;

  const match = new RegExp(words.join("\\s+"), "iu").exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function escapeForRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How the skill was proved, said honestly. A record from before formats existed has no
 * format, and was a written or spoken explanation plus a follow-up.
 */
export function provedByLine(skill: ProofSkill): string {
  const aloud = skill.integrity.inputMethod === "voice";
  if (skill.format === "catch" && skill.catch) {
    const caught = skill.catch.picks.filter((pick) => pick.fixed).length;
    return `Caught ${plural(caught, "planted mistake")} in an AI explanation and corrected ${caught === 1 ? "it" : "them"}`;
  }
  if (skill.format === "kid") {
    const grade = skill.readingGrade === undefined ? "" : `, reading grade ${Math.round(skill.readingGrade)} measured by code`;
    return `Explained it ${aloud ? "aloud " : ""}for a 10-year-old${grade}`;
  }
  if (skill.format === "timed") return aloud ? "Explained it aloud against a 30-second clock" : "Typed it against a 30-second clock";
  return aloud ? "Explained it aloud in their own words" : "Explained it in writing, in their own words";
}
