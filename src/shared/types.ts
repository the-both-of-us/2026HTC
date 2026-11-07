/**
 * Shared contract between features. Change it only when a feature truly needs to,
 * and keep it plain data: everything here is stored as JSON.
 */

export type SourceKind = "posting" | "pdf";

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
};

export type AttemptStatus = "needs-followup" | "proven" | "not-yet";

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
};

/** Progress for one user on one map. */
export type MapProgress = {
  mapId: string;
  ownerId: string;
  /** nodeId to the id of the attempt that proved it */
  proven: Record<string, string>;
  updatedAt: string;
};

export type NodeState = "locked" | "available" | "proven";

/**
 * 65, not 70: a node with 3 checkpoints scores 67 with 2 met, and that must pass.
 * No other reachable score falls between 65 and 70, so nothing else changes.
 */
export const PASS_SCORE = 65;
