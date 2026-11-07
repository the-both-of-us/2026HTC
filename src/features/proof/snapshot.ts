import type { GridSolve } from "@/features/grid";
import { isUsableQuote } from "@/features/teachback";
import { PASS_SCORE, type Attempt, type NodeState, type SkillMap, type SkillNode } from "@/shared/types";
import type { ProofGridSolve, ProofSkill, ProofSnapshot, ProofSource } from "./types";

type SnapshotInput = {
  proofId: string;
  displayName: string;
  publishedAt: string;
  map: SkillMap;
  states: Record<string, NodeState>;
  /** The attempt that proved each node, by node id. */
  attempts: Record<string, Attempt | null>;
  /** Grid questions the owner solved. Only passed for an energy map. */
  gridSolves?: GridSolve[];
};

/** Turns server data into the frozen document. Nothing in here comes from the browser. */
export function buildSnapshot(input: SnapshotInput): ProofSnapshot {
  const { map, states, attempts } = input;
  const skills: ProofSkill[] = [];
  const notYetProven: string[] = [];

  for (const node of map.nodes) {
    const attempt = attempts[node.id] ?? null;
    if (states[node.id] === "proven" && attempt && attemptProvesNode(attempt, map, node)) {
      skills.push(toProofSkill(node, attempt));
    } else {
      notYetProven.push(node.title);
    }
  }

  const grid = (input.gridSolves ?? []).map(toProofGridSolve);

  return {
    version: 1,
    proofId: input.proofId,
    displayName: input.displayName,
    roleTitle: map.title,
    roleSubtitle: map.subtitle,
    sourceKind: map.sourceKind,
    totalSkills: map.nodes.length,
    skills,
    notYetProven,
    ...(grid.length > 0 && { grid }),
    publishedAt: input.publishedAt,
  };
}

/** Only what a reader needs. The ids and AESO's ISO time stay out. */
function toProofGridSolve(solve: GridSolve): ProofGridSolve {
  return {
    title: solve.title,
    skill: solve.skill,
    answer: solve.answer,
    asOfLabel: solve.asOfLabel,
    figures: solve.figures,
    working: solve.working,
    stale: solve.stale,
    solvedAt: solve.solvedAt,
  };
}

/**
 * Progress alone is not enough. A skill only counts if the attempt behind it holds up:
 * same owner, same map and node, a passing score, a passed follow-up, and quotes that
 * really are in the person's text. Progress is saved first (see answerFollowUp), so an
 * attempt can be left unfinished if a save fails, and that must not count here.
 */
export function attemptProvesNode(attempt: Attempt, map: SkillMap, node: SkillNode): boolean {
  if (attempt.ownerId !== map.ownerId) return false;
  if (attempt.mapId !== map.id || attempt.nodeId !== node.id) return false;
  if (attempt.status !== "proven" || attempt.followUp?.passed !== true) return false;
  if (attempt.grade.score < PASS_SCORE) return false;

  return attempt.grade.checkpoints.every(
    (result) => !result.met || (result.quote !== null && isUsableQuote(result.quote, attempt.explanation)),
  );
}

function toProofSkill(node: SkillNode, attempt: Attempt): ProofSkill {
  return {
    nodeId: node.id,
    title: node.title,
    why: node.why,
    score: attempt.grade.score,
    explanation: attempt.explanation,
    checkpoints: attempt.grade.checkpoints.map(({ checkpoint, met, quote }) => ({
      checkpoint,
      met,
      quote: met ? quote : null,
    })),
    factualErrors: attempt.grade.misconceptions,
    rejectedQuotes: attempt.grade.rejectedQuotes,
    followUp: {
      question: attempt.followUp?.question ?? "",
      answer: attempt.followUp?.answer ?? "",
      feedback: attempt.followUp?.feedback ?? "",
    },
    integrity: { ...attempt.integrity },
    source: toProofSource(node),
    attemptedAt: attempt.createdAt,
  };
}

function toProofSource(node: SkillNode): ProofSource {
  if (!node.citation) return node.fromSource ? { status: "unverified" } : { status: "foundation" };
  if (!node.citation.verified) return { status: "unverified" };
  return {
    status: "verified",
    kind: node.citation.kind,
    quote: node.citation.quote,
    page: node.citation.page ?? null,
  };
}
