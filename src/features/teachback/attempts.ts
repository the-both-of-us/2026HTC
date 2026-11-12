import { randomUUID } from "node:crypto";
import { deriveNodeStates, getSkillMap } from "@/features/skill-map";
import { HttpError } from "@/shared/http";
import { claimDoc, deleteDoc, getDoc, listDocs, listKeys, putDoc } from "@/shared/store";
import {
  isPretestProof,
  PASS_SCORE,
  PRETEST_PROOF_ID,
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
  toCatchView,
  type CatchChallenge,
  type CatchPick,
  type CatchView,
} from "./catch";
import {
  createFinal,
  finalKey,
  finalPlan,
  finalView,
  getFinalRecord,
  gradeFinal,
  isFinalNodeId,
  isMcRecord,
  questionsToAvoid,
  saveFinalRecord,
  submitClaimKey,
  type FinalPlan,
  type FinalRecord,
  type FinalResult,
  type FinalView,
} from "./final";
import { gradeFollowUp } from "./followUp";
import { assignFormats, MAX_KID_GRADE, readingGrade, type TopicFormat } from "./formats";
import { computeScore, gradeExplanation } from "./grading";
import { countWords } from "./learnerText";
import { isUuid } from "@/shared/ids";

export const MIN_EXPLANATION_WORDS = 15;
export const MAX_EXPLANATION_CHARACTERS = 6_000;
export const MAX_ANSWER_CHARACTERS = 2_000;

/** The browser reports this figure, so a forged one can only claim so much. */
const MAX_ACTIVE_MS = 60 * 60 * 1000;
/** Twice the follow-up route's maxDuration. A claim this old belongs to a server that died. */
const ABANDONED_CLAIM_MS = 2 * 60 * 1000;
/** The model's reason for a fail is never shown: it often states the answer, which could be pasted back. */
const NOT_PASSED_FEEDBACK = "That answer did not show it.";


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
  /** wordCount is left out: the server counts the words itself. inputMethod is left out: explanations are always typed. */
  integrity: Omit<IntegritySignals, "wordCount" | "inputMethod">;
  /** The topic's own format, or "explain" when the learner swapped. Missing means "explain". */
  format?: TopicFormat;
  /** Only for "catch": the sentences the learner tapped. */
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
  // A pre-test pass may be backed by a real explanation later: passing replaces it. A real proof stays.
  if (state === "proven" && !isPretestProof(progress?.proven[node.id])) {
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

  const gradeStarted = performance.now();
  const grade = await gradeExplanation(node, explanation, map.audience, map);
  const gradeMs = Math.round(performance.now() - gradeStarted);
  // A 10-year-old's version gets its reading level measured by code, for the evidence page. It is
  // a tip, never a gate: one long run-on sentence of plain words measured grade 23 and blocked a 100.
  const level = format === "kid" ? readingGrade(explanation) : null;
  const plainLanguage = level === null ? null : { readingGrade: level, passed: level <= MAX_KID_GRADE };
  // A pass proves the skill straight away. There is no follow-up question any more (owner, Nov 9).
  const status = grade.score < PASS_SCORE ? "not-yet" : "proven";

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
      inputMethod: "typed",
    },
    grade,
    followUp: null,
    status,
    createdAt: new Date().toISOString(),
    timing: { gradeMs, followUpMs: null },
    // "explain" is left out, as on attempts saved before formats existed.
    ...(format !== "explain" && { format }),
    ...(plainLanguage && { plainLanguage }),
  };
  // Progress first, as in answerFollowUp: if saving the attempt then fails, the proof still holds up.
  if (status === "proven") await markProven(map.id, userId, node.id, attempt.id, format);
  await saveAttempt(attempt);
  return attempt;
}

/**
 * A "Catch the mistake" round. Code checks the tapped sentences against the planted ones, with
 * no AI call, so the result is instant. There is no follow-up: a pass proves the topic.
 * The round is played once. Afterwards the answers are known, so the learner explains instead.
 */
async function startCatch(userId: string, map: SkillMap, node: SkillNode, input: NewAttempt): Promise<Attempt> {
  if (await hasRevealed(map.id, userId, node.id)) {
    throw new AttemptError("You've seen where the mistakes were, so explain this one in your own words instead.", 409);
  }
  const challenge = await loadCatchChallenge(map, node);
  const picks = cleanPicks(input.picks ?? [], challenge);

  const gradeStarted = performance.now();
  const record = checkCatch(challenge, picks);
  const gradeMs = Math.round(performance.now() - gradeStarted);
  await markRevealed(map.id, userId, node.id);

  const grade = catchGrade(node, challenge, record.picks);
  const explanation = catchTranscript(challenge, picks);
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
      inputMethod: "typed",
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
 * each planted mistake is a checkpoint, met when the learner tapped it (the tapped sentence,
 * which is in the transcript, is the quote), and each correct sentence they tapped counts as
 * one error, minus 20.
 */
export function catchGrade(node: SkillNode, challenge: CatchChallenge, picks: CatchRecord["picks"]): Grade {
  const planted = new Set(challenge.mistakes.map((mistake) => mistake.sentence));
  const checkpoints = challenge.mistakes.map((mistake) => {
    const fix = picks.find((pick) => pick.sentence === mistake.sentence && pick.fixed);
    const quote = fix ? (challenge.sentences[mistake.sentence - 1] ?? null) : null;
    return { checkpoint: node.checkpoints[mistake.checkpoint] ?? mistake.why, quote, met: !!fix };
  });
  const misconceptions = picks
    .filter((pick) => !planted.has(pick.sentence))
    .map((pick) => `Marked sentence ${pick.sentence} as a mistake, but it was correct.`);
  const met = checkpoints.filter((result) => result.met).length;
  return { score: computeScore(met, checkpoints.length, misconceptions.length), checkpoints, misconceptions, rejectedQuotes: 0 };
}

/** Each tapped sentence once, and only sentences that exist. */
function cleanPicks(picks: CatchPick[], challenge: CatchChallenge): CatchPick[] {
  const sentences = new Set<number>();
  for (const pick of picks) {
    if (!Number.isInteger(pick.sentence) || pick.sentence < 1 || pick.sentence > challenge.sentences.length) {
      throw new AttemptError("One of those sentences isn't in this explanation. Reload the map, then try again.", 400);
    }
    sentences.add(pick.sentence);
  }
  if (sentences.size === 0) throw new AttemptError("Tap the sentence you think is wrong.", 400);
  return [...sentences].sort((a, b) => a - b).map((sentence) => ({ sentence }));
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

/**
 * Where the course's final test stands for its owner, or a unit's test when `unitId` is given.
 * Before submitting, the questions come without the key or explanations; after, with the review.
 * Someone else's map is a 404, like a missing one, and so is a unit test on a course that has none.
 */
export async function getFinalInterview(userId: string, mapId: string, unitId?: string): Promise<FinalView> {
  const map = await loadTestMap(mapId, userId);
  return loadFinalView(map, finalPlan(map, unitId));
}

/** Sets being written, by test key, so two quick clicks cost one model call. */
const writing = new Map<string, Promise<FinalView>>();

/**
 * Starts the test once every topic is proven (for a unit test: every topic of that unit; for a
 * degree course's final: every unit built, every topic proven and every unit test passed).
 * Asking again while it is under way, or after passing, returns the same set at no cost. After a
 * fail it always writes a new set (one model call), so answers cannot be learned by elimination.
 */
export async function startFinalInterview(userId: string, mapId: string, unitId?: string): Promise<FinalView> {
  const map = await loadTestMap(mapId, userId);
  const plan = finalPlan(map, unitId);
  const key = finalKey(map.id, plan.unitId);
  const pending = writing.get(key);
  if (pending) return pending;

  const work = (async () => {
    const current = await loadFinalView(map, plan);
    if (current.state === "locked") {
      throw new AttemptError(
        plan.kind === "unit"
          ? "Prove every topic in this unit first. Then its test opens."
          : map.syllabus?.assessment.unitTests
            ? "Prove every topic, in every unit, and pass each unit test first. Then the final test opens."
            : "Prove every topic on this map first. Then the final test opens.",
        403,
      );
    }
    if (current.state === "in-progress" || current.state === "passed") return current;

    // A retake is told the failed set's questions (and earlier ones), so it never repeats them.
    const avoid = current.state === "failed" ? questionsToAvoid(await getFinalRecord(map.id, plan.unitId)) : [];
    const record = await createFinal(map, userId, plan, Math.random, avoid);
    await saveFinalRecord(record);
    return finalView(record, true, plan);
  })().finally(() => {
    if (writing.get(key) === work) writing.delete(key);
  });
  writing.set(key, work);
  return work;
}

export type FinalSubmission = {
  /** The set being answered, from the view. */
  testId: string;
  /** The chosen option's index for each question, in order. */
  answers: number[];
};

/**
 * Grades a whole test in code, with no model call, and records the result where unlocks, course
 * completion and the evidence page read it. A set is submitted once: a second submission, or one
 * for a set that was replaced by a retake, is refused with a 409. The reply carries the review.
 */
export async function submitFinalTest(userId: string, mapId: string, unitId: string | undefined, submission: FinalSubmission): Promise<FinalView> {
  const map = await loadTestMap(mapId, userId);
  const plan = finalPlan(map, unitId);
  const record = await getFinalRecord(map.id, plan.unitId);
  if (!record || !isMcRecord(record) || record.ownerId !== userId) {
    throw new AttemptError("There is no test to submit yet. Start the test first.", 409);
  }
  if (record.testId !== submission.testId) {
    throw new AttemptError("This test was replaced by a newer set of questions. Reload the page to see it.", 409);
  }
  if (record.result) throw new AttemptError("This test was already submitted. Each test is submitted once.", 409);
  const { answers } = submission;
  const complete =
    answers.length === record.questions.length &&
    answers.every((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < record.questions[index].options.length);
  if (!complete) throw new AttemptError("Pick one answer for every question, then submit.", 400);

  // One submission per set, even if several arrive at the same moment.
  const claim = submitClaimKey(map.id, userId, record.testId);
  if (!(await claimDoc(claim, { claimedAt: new Date().toISOString() }))) {
    throw new AttemptError("This test was already submitted. Each test is submitted once.", 409);
  }
  try {
    const graded = gradeFinal(record, answers);
    await saveFinalRecord(graded);
    return finalView(graded, true, plan);
  } catch (error) {
    // Nothing was recorded, so the learner may submit again.
    await deleteDoc(claim).catch(() => undefined);
    throw error;
  }
}

/** One unit's test as the learner's map screen needs it. */
export type UnitTestView = { unitId: string; title: string; test: FinalView };

/**
 * Every built unit's test for a degree course, in unit order: locked until the unit's topics are
 * all proven, then ready, in progress, passed or failed. Empty for a course with no unit tests.
 */
export async function getUnitTests(userId: string, mapId: string): Promise<UnitTestView[]> {
  const map = await loadOwnMap(mapId, userId);
  if (!map.syllabus?.assessment.unitTests) return [];
  const built = map.syllabus.units.filter((unit) => unit.built);
  return Promise.all(
    built.map(async (unit) => ({ unitId: unit.id, title: unit.title, test: await loadFinalView(map, finalPlan(map, unit.id)) })),
  );
}

/** The unit tests of a course that were passed, by unit id: for "a degree course is done when every unit test is passed". */
export async function getPassedUnitTests(mapId: string): Promise<Record<string, FinalResult>> {
  const records = await listDocs<FinalRecord>(`final/${mapId}/`);
  return Object.fromEntries(
    records.flatMap((record) => (record.unitId !== undefined && record.result?.passed ? [[record.unitId, withQuestionCount(record)] as const] : [])),
  );
}

/**
 * For the evidence page and course completion: the course final's result, only when it was
 * passed. `format` and `questionCount` say how it was taken (absent on a written result).
 */
export async function getPassedFinal(mapId: string): Promise<FinalResult | null> {
  const record = await getFinalRecord(mapId);
  return record?.result?.passed ? withQuestionCount(record) : null;
}

/** A result with its question count, which a written record keeps only as its attempt list. */
function withQuestionCount(record: FinalRecord): FinalResult {
  const result = record.result!;
  if (result.questionCount !== undefined || isMcRecord(record)) return result;
  return { ...result, questionCount: record.attemptIds.length };
}

async function loadFinalView(map: SkillMap, plan: FinalPlan): Promise<FinalView> {
  const record = await getFinalRecord(map.id, plan.unitId);
  // Only the opening depends on this: a test already started is shown whatever the state of the rest.
  if (record && (isMcRecord(record) || record.result)) return finalView(record, true, plan);
  const progress = await getProgress(map.id, map.ownerId);
  const states = deriveNodeStates(map, progress);
  const topicsProven = plan.nodes.length > 0 && plan.nodes.every((node) => states[node.id] === "proven");
  const open = topicsProven && (plan.kind === "unit" || (await courseFinalOpen(map)));
  return finalView(record, open, plan);
}

/**
 * A course with a syllabus has its final open only once every planned unit is built (a map holds
 * just the units built so far, so "every node proven" alone would open it after unit 1), and,
 * for a course with unit tests, once each unit's test is passed. A course without one is
 * the old rule: every topic proven.
 */
async function courseFinalOpen(map: SkillMap): Promise<boolean> {
  // A catalog course whose syllabus is not there yet (or failed) has nothing to be tested on.
  if (!map.syllabus) return !map.courseId;
  // A syllabus still being written has more units to come.
  if (map.syllabus.planning) return false;
  if (!map.syllabus.units.every((unit) => unit.built)) return false;
  if (!map.syllabus.assessment.unitTests) return true;
  const passed = await getPassedUnitTests(map.id);
  return map.syllabus.units.every((unit) => passed[unit.id] !== undefined);
}

/** What the browser reports about a follow-up answer, like the explanation's integrity signals. */
export type AnswerDetails = { startedAfterMs?: number };

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

  // A question of a written final from before Nov 12. Tests are multiple choice now, so it is
  // never graded: the map offers a multiple-choice test in its place.
  if (isFinalNodeId(attempt.nodeId)) {
    throw new AttemptError("Tests are multiple choice now. Open the map to take this test as multiple choice.", 409);
  }
  const map = await loadOwnMap(attempt.mapId, userId);
  const node = findNode(map, attempt.nodeId);

  // One answer per attempt, even if several arrive at the same moment.
  await claimAnswer(attempt.id);
  try {
    const trimmedAnswer = answer.trim();
    const followUpStarted = performance.now();
    const result = await gradeFollowUp(node, attempt.explanation, attempt.followUp.question, trimmedAnswer, map.audience);
    const followUpMs = Math.round(performance.now() - followUpStarted);

    const finished: Attempt = {
      ...attempt,
      followUp: {
        ...attempt.followUp,
        answer: trimmedAnswer,
        passed: result.passed,
        feedback: result.passed ? result.feedback : NOT_PASSED_FEEDBACK,
        inputMethod: "typed",
        // Left out when unknown, so a record never claims more than the browser said.
        ...(details.startedAfterMs !== undefined && {
          startedAfterMs: Math.round(Math.min(details.startedAfterMs, MAX_ACTIVE_MS)),
        }),
      },
      status: result.passed ? "proven" : "not-yet",
      ...(attempt.timing && { timing: { ...attempt.timing, followUpMs } }),
    };

    // Progress goes first. If saving the attempt then fails, the learner can simply
    // answer again, which would not be possible the other way round.
    if (result.passed) await markProven(attempt.mapId, userId, node.id, attempt.id, attempt.format ?? "explain");
    await saveAttempt(finished);
    return finished;
  } catch (error) {
    // Nothing was decided, so give the learner their retry back.
    await deleteDoc(answerClaimKey(attempt.id)).catch(() => undefined);
    throw error;
  }
}

/** Returns the attempt, or null. The id comes from a URL, so it must look like one of ours. */
export async function getAttempt(id: string): Promise<Attempt | null> {
  if (!isUuid(id)) return null;
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
 * The owner's own progress counts. Anyone else has none, so only its first skills are open to them.
 */
export async function isNodeLockedFor(map: SkillMap, viewerId: string, nodeId: string): Promise<boolean> {
  const progress = viewerId !== "" && map.ownerId === viewerId ? await getProgress(map.id, viewerId) : null;
  return deriveNodeStates(map, progress)[nodeId] === "locked";
}

/**
 * When this learner did something on the map, as ISO timestamps: each proving attempt's start and
 * the moment it proved its topic, plus when each test was started and submitted (for an older
 * written test, the start of each question). For computing measured study time; nothing here is
 * estimated.
 */
export async function activityTimes(mapId: string, ownerId: string): Promise<string[]> {
  const [proved, allFinals] = await Promise.all([
    listDocs<ProvenRecord>(`${progressKey(mapId, ownerId)}/`),
    listDocs<FinalRecord>(`final/${mapId}`),
  ]);
  const finals = allFinals.filter((record) => record.mapId === mapId && record.ownerId === ownerId);
  const attemptIds = [
    ...proved.map((record) => record.attemptId),
    ...finals.flatMap((record) => (isMcRecord(record) ? [] : record.attemptIds)),
  ];
  const attempts = await Promise.all([...new Set(attemptIds)].map((id) => getAttempt(id)));
  return [
    ...proved.map((record) => record.provenAt),
    ...attempts.flatMap((attempt) => (attempt && attempt.ownerId === ownerId && attempt.mapId === mapId ? [attempt.createdAt] : [])),
    ...finals.flatMap((record) => (isMcRecord(record) ? [record.startedAt, ...(record.result ? [record.result.finishedAt] : [])] : [])),
  ].filter((time) => typeof time === "string" && !Number.isNaN(Date.parse(time)));
}

/**
 * The skills one user has proven on one map, with when. `pretest: true` marks a pre-test pass,
 * which every reader must label as one (PRETEST_PROOF_LABEL), never as an explanation.
 */
export async function listProvedNodes(
  mapId: string,
  ownerId: string,
): Promise<{ nodeId: string; provenAt: string; pretest?: true }[]> {
  const records = await listDocs<ProvenRecord>(`${progressKey(mapId, ownerId)}/`);
  return records.map(({ nodeId, provenAt, attemptId }) => ({ nodeId, provenAt, ...(isPretestProof(attemptId) && { pretest: true as const }) }));
}

/**
 * Records topics a learner answered correctly in a course pre-test as proved on their own map,
 * with format "pretest" and PRETEST_PROOF_ID in place of an attempt id. A topic may be in a unit
 * not built yet (its id is the future node id). A topic already proved is left as it is, so a
 * real proof is never replaced. Returns the topic ids it recorded.
 */
export async function markPretestProven(mapId: string, ownerId: string, topicIds: string[]): Promise<string[]> {
  const progress = await getProgress(mapId, ownerId);
  const fresh = [...new Set(topicIds)].filter((id) => !progress?.proven[id]);
  await Promise.all(fresh.map((id) => markProven(mapId, ownerId, id, PRETEST_PROOF_ID, "pretest")));
  return fresh;
}

export type ProgressView = {
  mapId: string;
  /** nodeId to the attempt id that proved it, or "pretest" (PRETEST_PROOF_ID) for a pre-test pass. */
  proven: Record<string, string>;
  /** nodeId to when it was unlocked anyway. */
  unlocked: Record<string, string>;
  states: Record<string, NodeState>;
  /**
   * Topic ids known from the course pre-test (their `proven` value is "pretest"), including
   * topics of units not built yet, so the map can mark them before their nodes exist. Label each
   * "Known: passed a pre-test question"; there is no attempt to open for them.
   */
  knownByPretest: string[];
};

/** What GET /api/maps/[id]/progress returns. Only the map's owner can read it. */
export async function getProgressView(userId: string, mapId: string): Promise<ProgressView> {
  const map = await loadOwnMap(mapId, userId);
  const progress = await getProgress(map.id, userId);
  const proven = progress?.proven ?? {};
  return {
    mapId: map.id,
    proven,
    unlocked: progress?.unlocked ?? {},
    states: deriveNodeStates(map, progress),
    knownByPretest: Object.keys(proven).filter((id) => isPretestProof(proven[id])),
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
  // Test submission claims are final-submits/<mapId>/<ownerId>/<testId>.
  const submitKeys = (await listKeys("final-submits/")).filter((key) => key.split("/")[2] === userId);

  await Promise.all([
    ...finals.map((record) => deleteDoc(finalKey(record.mapId, record.unitId))),
    ...submitKeys.map((key) => deleteDoc(key)),
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

/** A test belongs to its map's owner. Anyone else gets the same 404 as for a missing map. */
async function loadTestMap(mapId: string, userId: string): Promise<SkillMap> {
  const map = await getSkillMap(mapId);
  if (!map || userId === "" || map.ownerId !== userId) {
    throw new AttemptError("We could not find that map. Check the link, or build a new one.", 404);
  }
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
