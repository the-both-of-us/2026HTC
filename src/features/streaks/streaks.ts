import { deriveNodeStates, getSkillMap } from "@/features/skill-map";
import { getAttempt, getProgress, gradeFollowUp, MAX_ANSWER_CHARACTERS } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { edmontonDay } from "./days";
import { applyProof, dimLevel, emptyRecord, pickTopicOfTheDay, viewStreak, type MapHabits, type StreakRecord, type StreakView } from "./rules";

/**
 * One document per learner. Two proofs by the same person in the same instant could overwrite
 * each other's count, which costs at most one spark: a fair trade for one simple record.
 */
function streakKey(userId: string): string {
  return `streaks/${userId}`;
}

async function loadRecord(userId: string): Promise<StreakRecord> {
  return { ...emptyRecord(), ...(await getDoc<StreakRecord>(streakKey(userId))) };
}

export async function getStreak(userId: string, now = new Date()): Promise<StreakView> {
  return viewStreak(await loadRecord(userId), now);
}

/**
 * The hook point: call it once a topic is proved. The attempt id makes a retried request count
 * once. It never throws, because a streak must never cost anyone a proof.
 */
export async function recordProved(
  userId: string,
  proof: { mapId: string; nodeId: string; attemptId: string },
  now = new Date(),
): Promise<void> {
  try {
    const record = await loadRecord(userId);
    const { day, picks } = record.topicOfTheDay;
    const double = day === edmontonDay(now) && picks[proof.mapId] === proof.nodeId;
    await putDoc(streakKey(userId), applyProof(record, now, proof.attemptId, double));
  } catch (error) {
    console.error("[streaks] could not count a proof", error);
  }
}

export async function getMapHabits(userId: string, mapId: string, now = new Date()): Promise<MapHabits> {
  const map = await loadOwnMap(userId, mapId);
  const [record, progress] = await Promise.all([loadRecord(userId), getProgress(map.id, userId)]);
  const states = deriveNodeStates(map, progress);
  const today = edmontonDay(now);

  // Picked once a day, then kept, so proving it doesn't move the reward to another topic.
  let topicOfTheDay = record.topicOfTheDay.day === today ? (record.topicOfTheDay.picks[map.id] ?? null) : null;
  if (!topicOfTheDay) {
    const openIds = map.nodes.filter((node) => states[node.id] === "available").map((node) => node.id);
    topicOfTheDay = pickTopicOfTheDay(map.id, today, openIds);
    if (topicOfTheDay) {
      const picks = record.topicOfTheDay.day === today ? record.topicOfTheDay.picks : {};
      await putDoc(streakKey(userId), {
        ...record,
        topicOfTheDay: { day: today, picks: { ...picks, [map.id]: topicOfTheDay } },
      });
    }
  }

  // A topic was lit when its proving attempt was made, or when it was last relit.
  const dim: Record<string, number> = {};
  await Promise.all(
    Object.entries(progress?.proven ?? {}).map(async ([nodeId, attemptId]) => {
      const attempt = await getAttempt(attemptId);
      dim[nodeId] = dimLevel(litAt(attempt?.createdAt, record.relitAt[`${map.id}/${nodeId}`]), now);
    }),
  );

  return { streak: viewStreak(record, now), topicOfTheDay, dim };
}

/** The 60-second check that relights a fading topic: the follow-up that proved it, asked again. */
export async function startRelight(
  userId: string,
  mapId: string,
  nodeId: string,
  now = new Date(),
): Promise<{ question: string }> {
  const { question } = await loadFadingTopic(userId, mapId, nodeId, now);
  return { question };
}

export async function answerRelight(
  userId: string,
  mapId: string,
  nodeId: string,
  answer: string,
  now = new Date(),
): Promise<{ passed: boolean; feedback: string; streak: StreakView }> {
  if (answer.length > MAX_ANSWER_CHARACTERS) {
    throw new HttpError(`Please keep your answer under ${MAX_ANSWER_CHARACTERS.toLocaleString("en-CA")} characters.`, 400);
  }
  const { node, explanation, question } = await loadFadingTopic(userId, mapId, nodeId, now);
  const result = await gradeFollowUp(node, explanation, question, answer.trim());

  let record = await loadRecord(userId);
  if (result.passed) {
    record = applyProof(record, now, `relight/${mapId}/${nodeId}/${edmontonDay(now)}`);
    record = { ...record, relitAt: { ...record.relitAt, [`${mapId}/${nodeId}`]: now.toISOString() } };
    await putDoc(streakKey(userId), record);
  }
  return { passed: result.passed, feedback: result.feedback, streak: viewStreak(record, now) };
}

/** The later of when a topic was proved and when it was last relit. With neither, it counts as lit now. */
function litAt(provedAt: string | undefined, relitAt: string | undefined): string {
  return [provedAt, relitAt].filter((time): time is string => Boolean(time)).sort().at(-1) ?? new Date().toISOString();
}

/** For "Delete my data". Safe to run twice. */
export async function deleteStreak(userId: string): Promise<void> {
  await deleteDoc(streakKey(userId));
}

async function loadOwnMap(userId: string, mapId: string): Promise<SkillMap> {
  const map = await getSkillMap(mapId);
  // Someone else's map answers like a missing one.
  if (!map || map.ownerId !== userId) throw new HttpError("We could not find that map.", 404);
  return map;
}

async function loadFadingTopic(userId: string, mapId: string, nodeId: string, now = new Date()) {
  const map = await loadOwnMap(userId, mapId);
  const node = map.nodes.find((item) => item.id === nodeId);
  const attemptId = (await getProgress(map.id, userId))?.proven[nodeId];
  if (!node || !attemptId) throw new HttpError("Only a proved topic can be relit. Prove it first.", 409);

  const [attempt, record] = await Promise.all([getAttempt(attemptId), loadRecord(userId)]);
  if (dimLevel(litAt(attempt?.createdAt, record.relitAt[`${map.id}/${nodeId}`]), now) === 0) {
    throw new HttpError("This topic is still fully lit. Come back when it starts to fade.", 409);
  }
  return {
    node,
    explanation: attempt?.explanation ?? "",
    question:
      attempt?.followUp?.question ?? `In two or three sentences, explain ${node.title} to a friend, with one example.`,
  };
}
