/**
 * Shared contract between features. Change it only when a feature truly needs to,
 * and keep it plain data: everything here is stored as JSON.
 */

/** "topic" means the learner only named a subject: there is no source, so its maps have no citations. */
export type SourceKind = "posting" | "pdf" | "topic";

/** Where a skill came from. `verified` is set by code, never by the model. */
export type Citation = {
  kind: SourceKind;
  quote: string;
  /** 1-based PDF page. Absent for postings. */
  page?: number;
  verified: boolean;
};

export type SkillNode = {
  /** kebab-case, unique within a map */
  id: string;
  title: string;
  /** One plain sentence on why this job needs it. */
  why: string;
  /** Node ids that must be proven first. Validated to form a DAG. */
  prerequisites: string[];
  /** True if the source asks for this directly; false if it is a foundation for something it asks for. */
  fromSource: boolean;
  citation: Citation | null;
  /** 3 or 4 specific, checkable facts a real explanation must state. */
  checkpoints: string[];
};

/**
 * A skill as a browser gets it. Checkpoints are the answer key, so readers get how many
 * there are and never their text. Learners see them only in their own graded attempts.
 */
export type PublicSkillNode = Omit<SkillNode, "checkpoints"> & { checkpointCount: number };

export type SkillMap = {
  id: string;
  ownerId: string;
  title: string;
  /** Role, employer and place, when the source states them. */
  subtitle: string;
  sourceKind: SourceKind;
  /** Source text, kept so citations can be re-checked and shown. */
  sourceText: string;
  nodes: SkillNode[];
  createdAt: string;
  /** Set on a copy: the id of the map it was started from. */
  forkedFrom?: string;
  /** Set when this map is one course of a program, so its header can link back. */
  program?: ProgramLink;
  /**
   * Who the map is pitched at, such as "Grade 1 students (about 6 years old)". Absent or empty
   * means a general or adult learner. Lessons, teach-back, flashcards and quiz should pitch at it.
   */
  audience?: string;
};

/** Where a course map sits in its program. Fixed when the course is built. */
export type ProgramLink = {
  id: string;
  title: string;
  /** 1-based position of this course in the program. */
  courseNumber: number;
  courseCount: number;
  /** Titles of the courses that open once half of this one is proved. */
  unlocks: string[];
};

export type IntegritySignals = {
  pasted: boolean;
  /** Milliseconds of active typing or speaking. */
  activeMs: number;
  wordCount: number;
  inputMethod: "typed" | "voice";
};

export type CheckpointResult = {
  checkpoint: string;
  /** Exact learner words, verified by code. Null when not met. */
  quote: string | null;
  met: boolean;
};

export type Grade = {
  /** Computed by code: max(0, round(met / total * 100) - 20 * errors) */
  score: number;
  checkpoints: CheckpointResult[];
  misconceptions: string[];
  /** Model quotes that failed verification. Kept for the eval harness. */
  rejectedQuotes: number;
};

export type FollowUp = {
  question: string;
  answer: string | null;
  passed: boolean | null;
  feedback: string | null;
  /** How the answer was given, as the browser reported it. Missing on answers saved before Nov 7. */
  inputMethod?: "typed" | "voice";
  /** Milliseconds from the question appearing to the learner starting to answer. Missing when not known. */
  startedAfterMs?: number;
};

export type AttemptStatus = "needs-followup" | "proven" | "not-yet";

/**
 * How a skill was proved. "explain" is the original teach-back, "catch" is finding the AI's
 * planted mistakes, "kid" is explaining to a 10-year-old, "timed" is saying it in 30 seconds.
 * "final" marks a question in a course's final interview, which is not tied to one skill.
 */
export type ProofFormat = "explain" | "catch" | "kid" | "timed" | "final";

/** A finished "Catch the mistake" round, kept on its attempt. Sentence numbers start at 1. */
export type CatchRecord = {
  sentences: string[];
  /** Where the AI planted its mistakes, and what was wrong with each. */
  planted: { sentence: number; why: string }[];
  /** The sentences the learner tapped, with their correction. fixed is false for a correct sentence. */
  picks: { sentence: number; correction: string; fixed: boolean }[];
};

export type Attempt = {
  id: string;
  mapId: string;
  nodeId: string;
  ownerId: string;
  explanation: string;
  integrity: IntegritySignals;
  grade: Grade;
  followUp: FollowUp | null;
  status: AttemptStatus;
  createdAt: string;
  /**
   * How long the server took, measured around each call, in ms. Grading covers the AI finding
   * quotes plus code checking them and computing the score. Missing on attempts saved before Nov 7.
   */
  timing?: { gradeMs: number; followUpMs: number | null };
  /** Missing on attempts saved before formats existed, which were all "explain". */
  format?: ProofFormat;
  /** Only for "kid": the Flesch-Kincaid reading grade code measured, and whether it was plain enough. */
  plainLanguage?: { readingGrade: number; passed: boolean };
  /** Only for "catch". */
  catch?: CatchRecord;
};

/** Progress for one user on one map. */
export type MapProgress = {
  mapId: string;
  ownerId: string;
  /** nodeId to the id of the attempt that proved it */
  proven: Record<string, string>;
  /** nodeId to when the learner chose "Unlock anyway", skipping its prerequisites. */
  unlocked?: Record<string, string>;
  updatedAt: string;
};

export type NodeState = "locked" | "available" | "proven";

/**
 * 65, not 70: a node with 3 checkpoints scores 67 with 2 met, and that must pass.
 * No other reachable score falls between 65 and 70, so nothing else changes.
 */
export const PASS_SCORE = 65;
