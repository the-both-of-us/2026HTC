import type { CatchRecord, IntegritySignals, SourceKind } from "@/shared/types";

/** One checkpoint as it appears on the evidence page. */
export type ProofCheckpoint = {
  checkpoint: string;
  met: boolean;
  /** The person's exact words. Null when the checkpoint was not met. */
  quote: string | null;
};

/**
 * What a "Catch the mistake" skill shows publicly: counts only. A round is shared by every copy
 * of a course, so the planted sentences, their numbers and the reasons must never be public.
 */
export type ProofCatch = { plantedCount: number; caughtCount: number; wrongTaps: number };

/** Where the skill came from. A quote only appears here if code found it in the source. */
export type ProofSource =
  | { status: "verified"; kind: SourceKind; quote: string; page: number | null }
  | { status: "unverified" }
  | { status: "foundation" }
  /** The map came from a topic the person named, so there was no source to quote. */
  | { status: "topic" };

export type ProofSkill = {
  nodeId: string;
  title: string;
  why: string;
  score: number;
  explanation: string;
  checkpoints: ProofCheckpoint[];
  factualErrors: string[];
  /** Quotes the AI offered that code rejected, because they were not in the person's text. */
  rejectedQuotes: number;
  /**
   * inputMethod ("voice" only on pages published while answers could be spoken) and startedAfterMs are only present when they were recorded. Records
   * published before they existed don't have the keys, so their fingerprints still match.
   */
  followUp: {
    question: string;
    answer: string;
    feedback: string;
    inputMethod?: "typed" | "voice";
    startedAfterMs?: number;
  };
  integrity: IntegritySignals;
  source: ProofSource;
  attemptedAt: string;
  /**
   * How it was proved. Left out for "Explain it", so records published before formats
   * existed keep their fingerprint. A "catch" skill has no follow-up: its fields are empty.
   */
  format?: "catch" | "kid" | "timed";
  /**
   * Only for "catch". New records hold counts only (ProofCatch). Records published before Nov 8
   * still hold the full round (CatchRecord) so their fingerprint stays valid, but it is never
   * shown or sent: toPublicSnapshot turns it into counts first.
   */
  catch?: ProofCatch | CatchRecord;
  /** Only for "kid": the reading grade code measured. */
  readingGrade?: number;
};

/**
 * A topic the person answered correctly in the course's optional pre-test. It is not a teach-back:
 * there is no explanation, transcript, score or integrity signal behind it, and the page shows it
 * only with `label` ("Known: passed a pre-test question").
 */
export type ProofKnownByPretest = { nodeId: string; title: string; label: string; passedAt: string };

/**
 * A passed course final. Since Nov 12 it is a multiple-choice test graded by code (`format`
 * "multiple-choice", `passedCount` correct of `questionCount`). Pages published before then hold a
 * written final (no `format`), shown as written answers. Keys are left out when unknown, so older
 * records keep their fingerprint.
 */
export type ProofFinalInterview = {
  passedCount: number;
  /** Only on pages published while answers could be spoken. New pages leave it out. */
  spokenCount?: number;
  finishedAt: string;
  format?: "multiple-choice";
  questionCount?: number;
};

/** A passed unit test of a syllabus course, in unit order. Same honesty rules as the final. */
export type ProofUnitTest = {
  /** "Unit 2: Memory". */
  title: string;
  passedCount: number;
  questionCount?: number;
  format?: "multiple-choice";
  finishedAt: string;
};

/**
 * Everything the public page shows, frozen at publish time. This is what gets fingerprinted.
 * It never holds the owner id (that is their identity cookie), the map id or the source text.
 */
export type ProofSnapshot = {
  version: 1;
  proofId: string;
  displayName: string;
  roleTitle: string;
  roleSubtitle: string;
  sourceKind: SourceKind;
  totalSkills: number;
  skills: ProofSkill[];
  /**
   * Topics known from a pre-test pass, kept apart from `skills` (which are explanations). Left out
   * when there are none, so records published before pre-tests existed keep their fingerprint.
   */
  knownByPretest?: ProofKnownByPretest[];
  notYetProven: string[];
  /** Only once the course final was passed. Left out otherwise. */
  finalInterview?: ProofFinalInterview;
  /** Passed unit tests. Left out when there are none, so older records keep their fingerprint. */
  unitTests?: ProofUnitTest[];
  publishedAt: string;
};

export type LiveProof = {
  state: "live";
  id: string;
  ownerId: string;
  mapId: string;
  snapshot: ProofSnapshot;
  hash: string;
  /** See sealFor in hash.ts. Null when the server had no key at publish time. */
  seal: string | null;
};

/** Revoking removes the public copy. Only this note stays, so the page can say what happened. */
export type RevokedProof = {
  state: "revoked";
  id: string;
  ownerId: string;
  mapId: string;
  revokedAt: string;
};

export type ProofRecord = LiveProof | RevokedProof;

/** What the owner's share dialog gets back. */
export type OwnerProofView = {
  id: string;
  path: string;
  state: "live" | "revoked";
  displayName: string | null;
  provenCount: number | null;
  totalSkills: number | null;
  hash: string | null;
};

/** What GET /api/proof/[id]/verify returns. */
export type ProofCheckResult = {
  hashMatches: boolean;
  /** Null when this server has no seal key, so it can't say either way. */
  sealMatches: boolean | null;
  storedHash: string;
  recomputedHash: string;
  quotes: { verified: number; total: number };
  scores: { matching: number; total: number };
};
