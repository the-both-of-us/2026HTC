import { randomUUID } from "node:crypto";
import { deriveNodeStates, getSkillMap } from "@/features/skill-map";
import { HttpError } from "@/shared/http";
import { getDoc, putDoc } from "@/shared/store";
import {
  PASS_SCORE,
  type Attempt,
  type IntegritySignals,
  type MapProgress,
  type NodeState,
  type SkillMap,
  type SkillNode,
} from "@/shared/types";
import { generateFollowUp, gradeFollowUp } from "./followUp";
import { gradeExplanation } from "./grading";
import { countWords } from "./learnerText";

export const MIN_EXPLANATION_WORDS = 15;
export const MAX_EXPLANATION_CHARACTERS = 6_000;
export const MAX_ANSWER_CHARACTERS = 2_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A problem we can explain to the user. The message is safe to show them. */
export class AttemptError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "AttemptError";
  }
}

export type NewAttempt = {
  mapId: string;
  nodeId: string;
  explanation: string;
  /** wordCount is left out: the server counts the words itself. */
  integrity: Omit<IntegritySignals, "wordCount">;
};

/** Checks the learner may attempt this node, grades them, and asks a follow-up if they scored enough. */
export async function startAttempt(userId: string, input: NewAttempt): Promise<Attempt> {
  const map = await loadOwnMap(input.mapId, userId);
  const node = findNode(map, input.nodeId);

  const progress = await getProgress(map.id, userId);
  const state = deriveNodeStates(map, progress)[node.id];
  if (state === "locked") {
    throw new AttemptError("This skill is still locked. Prove the skills it depends on first.", 403);
  }
  if (state === "proven") {
    throw new AttemptError("You have already proven this skill. Pick another one on the map.", 409);
  }

  const explanation = input.explanation.trim();
  checkExplanationLength(explanation);

  const grade = await gradeExplanation(node, explanation);
  const status = grade.score < PASS_SCORE ? "not-yet" : "needs-followup";
  const question = status === "needs-followup" ? await generateFollowUp(node, explanation, grade) : null;

  const attempt: Attempt = {
    id: randomUUID(),
    mapId: map.id,
    nodeId: node.id,
    ownerId: userId,
    explanation,
    integrity: { ...input.integrity, wordCount: countWords(explanation) },
    grade,
    followUp: question ? { question, answer: null, passed: null, feedback: null } : null,
    status,
    createdAt: new Date().toISOString(),
  };
  await saveAttempt(attempt);
  return attempt;
}

/** Grades the follow-up answer. Passing it is what proves the node and unlocks the next ones. */
export async function answerFollowUp(userId: string, attemptId: string, answer: string): Promise<Attempt> {
  const attempt = await getOwnAttempt(userId, attemptId);
  if (attempt.status !== "needs-followup" || !attempt.followUp) {
    throw new AttemptError("This attempt is already finished. Start the skill again to retry.", 409);
  }
  if (answer.length > MAX_ANSWER_CHARACTERS) {
    throw new AttemptError(`Please keep your answer under ${MAX_ANSWER_CHARACTERS.toLocaleString("en-CA")} characters.`, 400);
  }

  const map = await loadOwnMap(attempt.mapId, userId);
  const node = findNode(map, attempt.nodeId);

  const trimmedAnswer = answer.trim();
  const result = await gradeFollowUp(node, attempt.explanation, attempt.followUp.question, trimmedAnswer);

  const finished: Attempt = {
    ...attempt,
    followUp: { ...attempt.followUp, answer: trimmedAnswer, passed: result.passed, feedback: result.feedback },
    status: result.passed ? "proven" : "not-yet",
  };

  // Progress goes first. If saving the attempt then fails, the learner can simply
  // answer again, which would not be possible the other way round.
  if (result.passed) await markProven(attempt.mapId, userId, node.id, attempt.id);
  await saveAttempt(finished);
  return finished;
}

/** Returns the attempt, or null. The id comes from a URL, so it must look like one of ours. */
export async function getAttempt(id: string): Promise<Attempt | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return getDoc<Attempt>(`attempts/${id}`);
}

/** Returns the attempt if it exists and belongs to this user, and otherwise throws. */
export async function getOwnAttempt(userId: string, attemptId: string): Promise<Attempt> {
  const attempt = await getAttempt(attemptId);
  if (!attempt) throw new AttemptError("We could not find that attempt. Please start the skill again.", 404);
  if (attempt.ownerId !== userId) throw new AttemptError("This attempt belongs to someone else.", 403);
  return attempt;
}

/** Returns one user's progress on one map, or null if they have proven nothing yet. */
export async function getProgress(mapId: string, ownerId: string): Promise<MapProgress | null> {
  return getDoc<MapProgress>(progressKey(mapId, ownerId));
}

export type ProgressView = {
  mapId: string;
  proven: Record<string, string>;
  states: Record<string, NodeState>;
};

/** What GET /api/maps/[id]/progress returns. Only the map's owner can read it. */
export async function getProgressView(userId: string, mapId: string): Promise<ProgressView> {
  const map = await loadOwnMap(mapId, userId);
  const progress = await getProgress(map.id, userId);
  return {
    mapId: map.id,
    proven: progress?.proven ?? {},
    states: deriveNodeStates(map, progress),
  };
}

/** An attempt as its own learner sees it. See toLearnerView. */
export type LearnerAttempt = Omit<Attempt, "ownerId">;

/**
 * What the API sends back. ownerId is removed because it is the identity cookie.
 *
 * While a follow-up is open, the missed checkpoints and misconceptions are held
 * back: the question probes exactly those, so sending them would give away the
 * answer. They are all returned once the attempt is finished.
 */
export function toLearnerView(attempt: Attempt): LearnerAttempt {
  const view: LearnerAttempt = {
    id: attempt.id,
    mapId: attempt.mapId,
    nodeId: attempt.nodeId,
    explanation: attempt.explanation,
    integrity: attempt.integrity,
    grade: attempt.grade,
    followUp: attempt.followUp,
    status: attempt.status,
    createdAt: attempt.createdAt,
  };
  if (attempt.status !== "needs-followup") return view;

  return {
    ...view,
    grade: {
      ...attempt.grade,
      checkpoints: attempt.grade.checkpoints.filter((result) => result.met),
      misconceptions: [],
    },
  };
}

async function loadOwnMap(mapId: string, userId: string): Promise<SkillMap> {
  const map = await getSkillMap(mapId);
  if (!map) throw new AttemptError("We could not find that map. Check the link, or build a new one.", 404);
  if (map.ownerId !== userId) throw new AttemptError("This map belongs to someone else. Build your own to prove these skills.", 403);
  return map;
}

function findNode(map: SkillMap, nodeId: string): SkillNode {
  const node = map.nodes.find((item) => item.id === nodeId);
  if (!node) throw new AttemptError("We could not find that skill on this map.", 404);
  return node;
}

function checkExplanationLength(explanation: string): void {
  const words = countWords(explanation);
  if (words < MIN_EXPLANATION_WORDS) {
    throw new AttemptError(
      `Please explain this in at least ${MIN_EXPLANATION_WORDS} words, so there is enough to check. You have ${words} so far.`,
      400,
    );
  }
  if (explanation.length > MAX_EXPLANATION_CHARACTERS) {
    throw new AttemptError(
      `Please keep your explanation under ${MAX_EXPLANATION_CHARACTERS.toLocaleString("en-CA")} characters.`,
      400,
    );
  }
}

async function markProven(mapId: string, ownerId: string, nodeId: string, attemptId: string): Promise<void> {
  const progress = await getProgress(mapId, ownerId);
  const updated: MapProgress = {
    mapId,
    ownerId,
    proven: { ...progress?.proven, [nodeId]: attemptId },
    updatedAt: new Date().toISOString(),
  };
  await putDoc(progressKey(mapId, ownerId), updated);
}

async function saveAttempt(attempt: Attempt): Promise<void> {
  await putDoc(`attempts/${attempt.id}`, attempt);
}

function progressKey(mapId: string, ownerId: string): string {
  return `progress/${mapId}/${ownerId}`;
}
