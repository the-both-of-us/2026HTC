/** The review queue and grading, for the learner's own maps only. */
import { getSavedFlashcards } from "@/features/flashcards";
import { getSkillMap, listMapsByOwner } from "@/features/skill-map";
import { CARD_NOT_FOUND, ReviewError } from "./errors";
import { buildQueue, toSummary, type CardSource } from "./queue";
import { reviewCard } from "./sm2";
import { logReview, readLogs, readState, readStates, saveState } from "./storage";
import type { Grade, ReviewQueue, ReviewSummary, ScheduleResult } from "./types";
import { isUuid } from "@/shared/ids";

/**
 * Every saved flashcard on the maps this user owns, including copies of courses and study
 * circles. Skills with no cards yet are skipped. A map deleted while this runs is skipped too.
 * Reads only: this never calls the model.
 */
async function collectCards(userId: string): Promise<CardSource[]> {
  const maps = await listMapsByOwner(userId);
  const perNode = await Promise.all(
    maps.flatMap((map) =>
      map.nodes.map(async (node): Promise<CardSource[]> => {
        const cards = await getSavedFlashcards(map.id, node.id, userId).catch((error: unknown) => {
          console.error("[review] could not read a skill's flashcards", error);
          return null;
        });
        return (cards ?? []).map((card) => ({
          cardId: card.id,
          mapId: map.id,
          nodeId: node.id,
          front: card.front,
          back: card.back,
          mapTitle: map.title,
          skillTitle: node.title,
        }));
      }),
    ),
  );
  return perNode.flat();
}

/** GET /api/review: due reviews first, then up to 20 new cards. */
export async function getReviewQueue(userId: string, now = new Date()): Promise<ReviewQueue> {
  if (!isUuid(userId)) return buildQueue([], new Map(), now);
  const [sources, states] = await Promise.all([collectCards(userId), readStates(userId)]);
  return buildQueue(sources, states, now);
}

/** The counts for the dashboard: what is due, what is new, and when the next card comes back. */
export async function getReviewSummary(userId: string, now = new Date()): Promise<ReviewSummary> {
  return toSummary(await getReviewQueue(userId, now));
}

export type GradeRequest = { mapId: string; nodeId: string; cardId: string; grade: Grade };

/**
 * POST /api/review: grades one card. The map must be the viewer's own and the card must be
 * in that skill's saved deck; anything else is the same 404, so nobody can probe for cards.
 */
export async function gradeCard(userId: string, request: GradeRequest, now = new Date()): Promise<ScheduleResult> {
  const map = await getSkillMap(request.mapId);
  if (!map || map.ownerId !== userId || !isUuid(userId)) throw new ReviewError(CARD_NOT_FOUND, 404);
  const node = map.nodes.find((candidate) => candidate.id === request.nodeId);
  if (!node) throw new ReviewError(CARD_NOT_FOUND, 404);

  const deck = await getSavedFlashcards(map.id, node.id, userId);
  const card = deck?.find((candidate) => candidate.id === request.cardId);
  if (!card || !isUuid(card.id)) throw new ReviewError(CARD_NOT_FOUND, 404);

  const previous = await readState(userId, card.id);
  const next = reviewCard(previous, { cardId: card.id, mapId: map.id, nodeId: node.id }, request.grade, now);
  await saveState(userId, next);
  await logReview(userId, now);
  return { dueAt: next.dueAt, intervalDays: next.intervalDays };
}

/**
 * When this user reviewed, as ISO timestamps, oldest first, for the streak. It joins each
 * card's last review with the daily log, which keeps days a card was reviewed before its latest
 * review. Pass `since` to leave out older ones.
 */
export async function listReviewActivity(userId: string, since?: Date): Promise<string[]> {
  if (!isUuid(userId)) return [];
  const [states, logs] = await Promise.all([readStates(userId), readLogs(userId)]);
  const times = new Set<string>();
  for (const state of states.values()) if (state.lastReviewedAt) times.add(state.lastReviewedAt);
  for (const log of logs) {
    if (log.firstAt) times.add(log.firstAt);
    if (log.lastAt) times.add(log.lastAt);
  }
  const sinceIso = since?.toISOString();
  return [...times].filter((time) => !sinceIso || time >= sinceIso).sort();
}
