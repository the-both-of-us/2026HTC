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
  | { status: "foundation" };

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
  followUp: { question: string; answer: string; feedback: string };
  integrity: IntegritySignals;
  source: ProofSource;
  attemptedAt: string;
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
