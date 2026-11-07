import type { IntegritySignals, SourceKind } from "@/shared/types";

/** One checkpoint as it appears on the evidence page. */
export type ProofCheckpoint = {
  checkpoint: string;
  met: boolean;
  /** The person's exact words. Null when the checkpoint was not met. */
  quote: string | null;
};

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
   * inputMethod and startedAfterMs are only present when they were recorded. Records
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
};

/** A "Read the Grid" question the person answered correctly, checked by code on the server. */
export type ProofGridSolve = {
  title: string;
  /** "the reserve margin", for "Worked out the reserve margin from AESO's reading at 13:45". */
  skill: string;
  answer: string;
  /** AESO's report time, in AESO's words, such as "Nov 07, 2026 13:45" (Alberta time). */
  asOfLabel: string;
  figures: { label: string; value: string }[];
  working: string[];
  /** The report was over 15 minutes old when it was solved. */
  stale: boolean;
  solvedAt: string;
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
  notYetProven: string[];
  /**
   * Only on an energy map whose owner solved a grid question. Left out otherwise, rather than
   * set empty, so a record published before this field existed keeps the same fingerprint.
   */
  grid?: ProofGridSolve[];
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
