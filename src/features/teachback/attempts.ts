import { randomUUID } from "node:crypto";
import { tierFor } from "@/features/settings";
import { deriveNodeStates, getSkillMap } from "@/features/skill-map";
import { HttpError } from "@/shared/http";
import { claimDoc, deleteDoc, getDoc, listDocs, listKeys, putDoc } from "@/shared/store";
import {
  PASS_SCORE,
  type Attempt,
  type CatchRecord,
  type Grade,
  type IntegritySignals,
  type MapProgress,
  type NodeState,
  type ProofFormat,
  type SkillMap,
  type SkillNode,
} from "@/shared/types";
import {
  catchTranscript,
  checkCatch,
  hasRevealed,
  loadCatchChallenge,
  markRevealed,
  MIN_CORRECTION_WORDS,
  toCatchView,
  type CatchChallenge,
  type CatchPick,
  type CatchView,
} from "./catch";
import {
  createFinal,
  FINAL_NODE_ID,
  finalView,
  getFinalRecord,
  gradeFinalAnswer,
  saveFinalRecord,
  settle,
  type FinalRecord,
  type FinalView,
} from "./final";
import { generateFollowUp, gradeFollowUp } from "./followUp";
import { assignFormats, MAX_KID_GRADE, readingGrade, type TopicFormat } from "./formats";
import { computeScore, gradeExplanation } from "./grading";
import { countWords } from "./learnerText";

export const MIN_EXPLANATION_WORDS = 15;
export const MAX_EXPLANATION_CHARACTERS = 6_000;
export const MAX_ANSWER_CHARACTERS = 2_000;
export const MAX_CORRECTION_CHARACTERS = 400;

/** The browser reports this figure, so a forged one can only claim so much. */
const MAX_ACTIVE_MS = 60 * 60 * 1000;
/** Twice the follow-up route's maxDuration. A claim this old belongs to a server that died. */
const ABANDONED_CLAIM_MS = 2 * 60 * 1000;
/** The model's reason for a fail is never shown: it often states the answer, which could be pasted back. */
const NOT_PASSED_FEEDBACK = "That answer did not show it.";

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
  /** The topic's own format, or "explain" when the learner swapped. Missing means "explain". */
  format?: TopicFormat;
  /** Only for "catch": the sentences the learner tapped, with their corrections. */
  picks?: CatchPick[];
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

  // Each topic has one format. "Explain it" is always allowed, because the learner may swap to it.
  const format = input.format ?? "explain";
  if (format !== "explain" && format !== assignFormats(map.nodes)[node.id]) {
    throw new AttemptError("This topic uses a different format now. Reload the map, then try again.", 400);
  }
  if (format === "catch") return startCatch(userId, map, node, input);

  const explanation = input.explanation.trim();
  checkExplanationLength(explanation);

  // The model router for answer checks: gpt-oss-120b unless the course's stakes are high or the learner chose otherwise.
  const tier = await tierFor("checks", userId, map.rating);
  const gradeStarted = performance.now();
  const grade = await gradeExplanation(node, explanation, map.audience, tier);
  const gradeMs = Math.round(performance.now() - gradeStarted);
  // A 10-year-old's version must also read simply. Code measures that, not the AI.
  const level = format === "kid" ? readingGrade(explanation) : null;
  const plainLanguage = level === null ? null : { readingGrade: level, passed: level <= MAX_KID_GRADE };
  const status = grade.score < PASS_SCORE || plainLanguage?.passed === false ? "not-yet" : "needs-followup";
  const question = status === "needs-followup" ? await generateFollowUp(node, explanation, grade, map.audience, tier) : null;

  const attempt: Attempt = {
    id: randomUUID(),
    mapId: map.id,
    nodeId: node.id,
    ownerId: userId,
    explanation,
    integrity: {
      ...input.integrity,
      activeMs: Math.min(input.integrity.activeMs, MAX_ACTIVE_MS),
      wordCount: countWords(explanation),
    },
    grade,
    followUp: question ? { question, answer: null, passed: null, feedback: null } : null,
    status,
    createdAt: new Date().toISOString(),
    timing: { gradeMs, followUpMs: null },
    // "explain" is left out, as on attempts saved before formats existed.
    ...(format !== "explain" && { format }),
    ...(plainLanguage && { plainLanguage }),
  };
  await saveAttempt(attempt);
  return attempt;
}

/**
 * A "Catch the mistake" round. Code checks the tapped sentences against the planted ones,
 * and the AI only checks the corrections. There is no follow-up: a pass proves the topic.
 * The round is played once. Afterwards the answers are known, so the learner explains instead.
 */
async function startCatch(userId: string, map: SkillMap, node: SkillNode, input: NewAttempt): Promise<Attempt> {
  if (await hasRevealed(map.id, userId, node.id)) {
    throw new AttemptError("You've seen where the mistakes were, so explain this one in your own words instead.", 409);
  }
  const challenge = await loadCatchChallenge(map, node);
  const picks = cleanPicks(input.picks ?? [], challenge);

  const tier = await tierFor("checks", userId, map.rating);
  const gradeStarted = performance.now();
  const record = await checkCatch(node, challenge, picks, map.audience, tier);
  const gradeMs = Math.round(performance.now() - gradeStarted);
  await markRevealed(map.id, userId, node.id);

  const grade = catchGrade(node, challenge, record.picks);
  const explanation = catchTranscript(picks);
  const attempt: Attempt = {
    id: randomUUID(),
    mapId: map.id,
    nodeId: node.id,
    ownerId: userId,
    explanation,
    integrity: {
      ...input.integrity,
      activeMs: Math.min(input.integrity.activeMs, MAX_ACTIVE_MS),
      wordCount: countWords(explanation),
    },
    grade,
    followUp: null,
    status: grade.score >= PASS_SCORE ? "proven" : "not-yet",
    createdAt: new Date().toISOString(),
    timing: { gradeMs, followUpMs: null },
    format: "catch",
    catch: record,
  };
  if (attempt.status === "proven") await markProven(map.id, userId, node.id, attempt.id, "catch");
  await saveAttempt(attempt);
  return attempt;
}

/**
 * Scored with the same formula as an explanation, so the evidence page can re-check it:
 * each planted mistake is a checkpoint, met when the learner fixed it (their correction is
 * the quote), and each correct sentence they tapped counts as one error, minus 20.
 */
export function catchGrade(node: SkillNode, challenge: CatchChallenge, picks: CatchRecord["picks"]): Grade {
  const planted = new Set(challenge.mistakes.map((mistake) => mistake.sentence));
  const checkpoints = challenge.mistakes.map((mistake) => {
    const fix = picks.find((pick) => pick.sentence === mistake.sentence && pick.fixed);
    return { checkpoint: node.checkpoints[mistake.checkpoint] ?? mistake.why, quote: fix?.correction ?? null, met: !!fix };
  });
  const misconceptions = picks
    .filter((pick) => !planted.has(pick.sentence))
    .map((pick) => `Marked sentence ${pick.sentence} as a mistake, but it was correct.`);
  const met = checkpoints.filter((result) => result.met).length;
  return { score: computeScore(met, checkpoints.length, misconceptions.length), checkpoints, misconceptions, rejectedQuotes: 0 };
}

/** One correction per sentence, each with a few words, on sentences that exist. */
function cleanPicks(picks: CatchPick[], challenge: CatchChallenge): CatchPick[] {
  const bySentence = new Map<number, CatchPick>();
  for (const pick of picks) {
    if (!Number.isInteger(pick.sentence) || pick.sentence < 1 || pick.sentence > challenge.sentences.length) {
      throw new AttemptError("One of those sentences isn't in this explanation. Reload the map, then try again.", 400);
    }
    const correction = pick.correction.replace(/\s+/g, " ").trim();
    if (countWords(correction) < MIN_CORRECTION_WORDS) {
      throw new AttemptError(`Say what's wrong with sentence ${pick.sentence} in at least ${MIN_CORRECTION_WORDS} words.`, 400);
    }
    if (correction.length > MAX_CORRECTION_CHARACTERS) {
      throw new AttemptError(`Please keep each correction under ${MAX_CORRECTION_CHARACTERS} characters.`, 400);
    }
    bySentence.set(pick.sentence, { sentence: pick.sentence, correction });
  }
  if (bySentence.size === 0) throw new AttemptError("Tap the sentence you think is wrong, then say what's true.", 400);
  return [...bySentence.values()].sort((a, b) => a.sentence - b.sentence);
}

/** The sentences of this topic's catch round, without which ones are wrong. */
export async function getCatchView(
  userId: string,
  mapId: string,
  nodeId: string,
): Promise<CatchView & { revealed: boolean }> {
  const map = await loadOwnMap(mapId, userId);
  const node = findNode(map, nodeId);
  const progress = await getProgress(map.id, userId);
  if (deriveNodeStates(map, progress)[node.id] === "locked") {
    throw new AttemptError("This skill is still locked. Prove the skills it depends on first.", 403);
  }
  if (assignFormats(map.nodes)[node.id] !== "catch") {
    throw new AttemptError("This topic uses a different format.", 400);
  }
  const [challenge, revealed] = await Promise.all([loadCatchChallenge(map, node), hasRevealed(map.id, userId, node.id)]);
  return { ...toCatchView(challenge), revealed };
}

/** Where the course's final interview stands for its owner. */
export async function getFinalInterview(userId: string, mapId: string): Promise<FinalView> {
  const map = await loadOwnMap(mapId, userId);
  return loadFinalView(map, userId);
}

/**
 * Starts the final interview once every topic is proven. Asking again while it is under way
 * returns the same questions, and after a fail it writes new ones.
 */
export async function startFinalInterview(userId: string, mapId: string): Promise<FinalView> {
  const map = await loadOwnMap(mapId, userId);
  const current = await loadFinalView(map, userId);
  if (current.state === "locked") {
    throw new AttemptError("Prove every topic on this map first. Then the final interview opens.", 403);
  }
  if (current.state === "in-progress" || current.state === "passed") return current;

  const { record, attempts } = await createFinal(map, userId);
  await Promise.all(attempts.map(saveAttempt));
  await saveFinalRecord(record);
  return finalView(record, attempts, true);
}

/** For the evidence page: the final interview's result, only when it was passed. */
export async function getPassedFinal(mapId: string): Promise<FinalRecord["result"] | null> {
  const record = await getFinalRecord(mapId);
  return record?.result?.passed ? record.result : null;
}

async function loadFinalView(map: SkillMap, userId: string): Promise<FinalView> {
  const progress = await getProgress(map.id, userId);
  const states = deriveNodeStates(map, progress);
  const allProven = map.nodes.every((node) => states[node.id] === "proven");
  const record = await getFinalRecord(map.id);
  const attempts = record ? await Promise.all(record.attemptIds.map(getAttempt)) : [];
  return finalView(record, attempts, allProven);
}

/** How the follow-up was answered. The browser reports it, like the explanation's integrity signals. */
export type AnswerDetails = { inputMethod?: "typed" | "voice"; startedAfterMs?: number };

/** Grades the follow-up answer. Passing it is what proves the node and unlocks the next ones. */
export async function answerFollowUp(
  userId: string,
  attemptId: string,
  answer: string,
  details: AnswerDetails = {},
): Promise<Attempt> {
  const attempt = await getOwnAttempt(userId, attemptId);
  if (attempt.status !== "needs-followup" || !attempt.followUp) {
    throw new AttemptError("This attempt is already finished. Start the skill again to retry.", 409);
  }
  if (answer.length > MAX_ANSWER_CHARACTERS) {
    throw new AttemptError(`Please keep your answer under ${MAX_ANSWER_CHARACTERS.toLocaleString("en-CA")} characters.`, 400);
  }

  const map = await loadOwnMap(attempt.mapId, userId);
  const isFinal = attempt.nodeId === FINAL_NODE_ID;
  const node = isFinal ? null : findNode(map, attempt.nodeId);

  // One answer per attempt, even if several arrive at the same moment.
  await claimAnswer(attempt.id);
  try {
    const trimmedAnswer = answer.trim();
    const tier = await tierFor("checks", userId, map.rating);
    const followUpStarted = performance.now();
    const result = node
      ? await gradeFollowUp(node, attempt.explanation, attempt.followUp.question, trimmedAnswer, map.audience, tier)
      : await gradeFinalAnswer(map, attempt.followUp.question, trimmedAnswer, tier);
    const followUpMs = Math.round(performance.now() - followUpStarted);

    const finished: Attempt = {
      ...attempt,
      followUp: {
        ...attempt.followUp,
        answer: trimmedAnswer,
        passed: result.passed,
        feedback: result.passed ? result.feedback : NOT_PASSED_FEEDBACK,
        // Left out when unknown, so a record never claims more than the browser said.
        ...(details.inputMethod && { inputMethod: details.inputMethod }),
        ...(details.startedAfterMs !== undefined && {
          startedAfterMs: Math.round(Math.min(details.startedAfterMs, MAX_ACTIVE_MS)),
        }),
      },
      status: result.passed ? "proven" : "not-yet",
      ...(attempt.timing && { timing: { ...attempt.timing, followUpMs } }),
    };

    // Progress goes first. If saving the attempt then fails, the learner can simply
    // answer again, which would not be possible the other way round.
    if (result.passed && node) await markProven(attempt.mapId, userId, node.id, attempt.id, attempt.format ?? "explain");
    await saveAttempt(finished);
    if (isFinal) await settleFinal(map.id);
    return finished;
  } catch (error) {
    // Nothing was decided, so give the learner their retry back.
    await deleteDoc(answerClaimKey(attempt.id)).catch(() => undefined);
    throw error;
  }
}

/** After each final interview answer: once all three are in, the result is saved. */
async function settleFinal(mapId: string): Promise<void> {
  const record = await getFinalRecord(mapId);
  if (!record || record.result) return;
  const settled = settle(record, await Promise.all(record.attemptIds.map(getAttempt)));
  if (settled !== record) await saveFinalRecord(settled);
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

/**
 * Returns one user's progress on one map: what they proved, and what they unlocked anyway.
 * Null if they have done neither yet.
 */
export async function getProgress(mapId: string, ownerId: string): Promise<MapProgress | null> {
  const [records, unlocks] = await Promise.all([
    listDocs<ProvenRecord>(`${progressKey(mapId, ownerId)}/`),
    listDocs<UnlockRecord>(`${unlockPrefix(mapId, ownerId)}`),
  ]);
  if (records.length === 0 && unlocks.length === 0) return null;

  return {
    mapId,
    ownerId,
    proven: Object.fromEntries(records.map((record) => [record.nodeId, record.attemptId])),
    ...(unlocks.length > 0 && {
      unlocked: Object.fromEntries(unlocks.map((unlock) => [unlock.nodeId, unlock.unlockedAt])),
    }),
    updatedAt: [...records.map((record) => record.provenAt), ...unlocks.map((unlock) => unlock.unlockedAt)]
      .sort()
      .at(-1) as string,
  };
}

/**
 * "Unlock anyway": opens a locked skill for its owner without proving its prerequisites.
 * It then counts as available everywhere, so it can be studied and proven. Unlocking a
 * skill that is already open changes nothing.
 */
export async function unlockNode(userId: string, mapId: string, nodeId: string): Promise<ProgressView> {
  const map = await loadOwnMap(mapId, userId);
  const node = findNode(map, nodeId);
  const progress = await getProgress(map.id, userId);
  if (deriveNodeStates(map, progress)[node.id] === "locked") {
    const record: UnlockRecord = { nodeId: node.id, unlockedAt: new Date().toISOString() };
    await putDoc(`${unlockPrefix(map.id, userId)}${node.id}`, record);
  }
  return getProgressView(userId, map.id);
}

/**
 * Whether a skill is still locked for this viewer, so nothing is generated for it yet.
 * The owner's own progress counts. Anyone else reading a published course has none, so
 * only its first skills are open to them.
 */
export async function isNodeLockedFor(map: SkillMap, viewerId: string, nodeId: string): Promise<boolean> {
  const progress = viewerId !== "" && map.ownerId === viewerId ? await getProgress(map.id, viewerId) : null;
  return deriveNodeStates(map, progress)[nodeId] === "locked";
}

/** The skills one user has proven on one map, with when, for a study circle's feed. No explanation text. */
export async function listProvedNodes(mapId: string, ownerId: string): Promise<{ nodeId: string; provenAt: string }[]> {
  const records = await listDocs<ProvenRecord>(`${progressKey(mapId, ownerId)}/`);
  return records.map(({ nodeId, provenAt }) => ({ nodeId, provenAt }));
}

export type ProgressView = {
  mapId: string;
  proven: Record<string, string>;
  /** nodeId to when it was unlocked anyway. */
  unlocked: Record<string, string>;
  states: Record<string, NodeState>;
};

/** What GET /api/maps/[id]/progress returns. Only the map's owner can read it. */
export async function getProgressView(userId: string, mapId: string): Promise<ProgressView> {
  const map = await loadOwnMap(mapId, userId);
  const progress = await getProgress(map.id, userId);
  return {
    mapId: map.id,
    proven: progress?.proven ?? {},
    unlocked: progress?.unlocked ?? {},
    states: deriveNodeStates(map, progress),
  };
}

/**
 * For "Delete my data": removes every attempt this person made, with its answer claim,
 * and every skill they proved. Returns how many attempts and proven skills went.
 */
export async function deleteLearnerData(userId: string): Promise<{ attempts: number; provenSkills: number }> {
  // "attempts/" also holds answer claims, which have no ownerId, so the filter skips them.
  const attempts = (await listDocs<Attempt>("attempts/")).filter((attempt) => attempt.ownerId === userId);
  // Progress keys are progress/<mapId>/<ownerId>/<nodeId>, so the key says whose it is.
  const progressKeys = (await listKeys("progress/")).filter((key) => key.split("/")[2] === userId);
  const finals = (await listDocs<FinalRecord>("final/")).filter((record) => record.ownerId === userId);
  const revealedKeys = (await listKeys("catch-revealed/")).filter((key) => key.split("/")[2] === userId);
  // Unlock keys are unlocks/<mapId>/<ownerId>/<nodeId>, like progress keys.
  const unlockKeys = (await listKeys("unlocks/")).filter((key) => key.split("/")[2] === userId);

  await Promise.all([
    ...finals.map((record) => deleteDoc(`final/${record.mapId}`)),
    ...attempts.flatMap((attempt) => [deleteDoc(`attempts/${attempt.id}`), deleteDoc(answerClaimKey(attempt.id))]),
    ...progressKeys.map((key) => deleteDoc(key)),
    ...revealedKeys.map((key) => deleteDoc(key)),
    ...unlockKeys.map((key) => deleteDoc(key)),
  ]);
  return { attempts: attempts.length, provenSkills: progressKeys.length };
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
    ...(attempt.timing && { timing: attempt.timing }),
    ...(attempt.format && { format: attempt.format }),
    ...(attempt.plainLanguage && { plainLanguage: attempt.plainLanguage }),
    ...(attempt.catch && { catch: attempt.catch }),
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

/** One document per proven skill, so two skills proven at the same moment can't overwrite each other. */
type ProvenRecord = { nodeId: string; attemptId: string; provenAt: string; format?: ProofFormat };

async function markProven(
  mapId: string,
  ownerId: string,
  nodeId: string,
  attemptId: string,
  format: ProofFormat,
): Promise<void> {
  const record: ProvenRecord = { nodeId, attemptId, provenAt: new Date().toISOString(), format };
  await putDoc(`${progressKey(mapId, ownerId)}/${nodeId}`, record);
}

/** Lets one caller grade this attempt's answer. Anyone else gets a 409 until it finishes. */
async function claimAnswer(attemptId: string): Promise<void> {
  const key = answerClaimKey(attemptId);
  const claim = { claimedAt: new Date().toISOString() };
  if (await claimDoc(key, claim)) return;

  const existing = await getDoc<typeof claim>(key);
  const abandoned = existing !== null && Date.now() - Date.parse(existing.claimedAt) > ABANDONED_CLAIM_MS;
  if (abandoned) await deleteDoc(key);
  if (abandoned && (await claimDoc(key, claim))) return;

  throw new AttemptError("This answer is already being checked. Give it a few seconds, then try again.", 409);
}

function answerClaimKey(attemptId: string): string {
  return `attempts/${attemptId}/claim`;
}

async function saveAttempt(attempt: Attempt): Promise<void> {
  await putDoc(`attempts/${attempt.id}`, attempt);
}

/** One "Unlock anyway", at unlocks/<mapId>/<ownerId>/<nodeId>. */
type UnlockRecord = { nodeId: string; unlockedAt: string };

function unlockPrefix(mapId: string, ownerId: string): string {
  return `unlocks/${mapId}/${ownerId}/`;
}

function progressKey(mapId: string, ownerId: string): string {
  return `progress/${mapId}/${ownerId}`;
}
