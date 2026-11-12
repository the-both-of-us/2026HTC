import { HttpError } from "@/shared/http";
import { claimDoc, deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import { MC_OPTION_COUNT } from "@/shared/multipleChoice";
import type { PretestQuestion, PretestQuestionSet, PretestRecord } from "./types";

/*
 * Keys.
 * - Canonical, per course: `pretest-sets/<courseId>/<unitId>` (no learner data; kept by "Delete my
 *   data"; written under startOnce, so also `claims/pretest-sets/…` and `partial/pretest-sets/…`
 *   while one is written).
 * - Per learner: `pretest/<courseId>/<ownerId>` (the record) and `pretest/<courseId>/<ownerId>/lock`
 *   (held while a change is made). The owner is the third segment of both, so "Delete my data"
 *   finds them by key. Proofs themselves are teachback's progress records.
 */

export const SET_PREFIX = "pretest-sets/";
export const RECORD_PREFIX = "pretest/";

/** Ids that go into a key: a catalog UUID, an owner id cookie or a syllabus unit id. */
const KEY_PART = /^[A-Za-z0-9_-]{1,100}$/;

function checkPart(part: string): string {
  if (!KEY_PART.test(part)) throw new HttpError("We could not find that pre-test.", 404);
  return part;
}

export const setKey = (courseId: string, unitId: string) => `${SET_PREFIX}${checkPart(courseId)}/${checkPart(unitId)}`;
export const recordKey = (courseId: string, ownerId: string) => `${RECORD_PREFIX}${checkPart(courseId)}/${checkPart(ownerId)}`;
const lockKey = (courseId: string, ownerId: string) => `${recordKey(courseId, ownerId)}/lock`;

/**
 * True for a multiple-choice set. A set written before multiple choice (short answers with
 * `keyPoints`) has no options, so it counts as missing and is written again.
 */
export function isMultipleChoiceSet(value: unknown): value is PretestQuestionSet {
  if (typeof value !== "object" || value === null) return false;
  const { questions } = value as { questions?: unknown };
  return (
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every((question) => {
      const q = question as Partial<PretestQuestion> | null;
      return (
        typeof q?.topicId === "string" &&
        typeof q.question === "string" &&
        typeof q.explanation === "string" &&
        Array.isArray(q.options) &&
        q.options.length === MC_OPTION_COUNT &&
        q.options.every((option) => typeof option === "string")
      );
    })
  );
}

/** The unit's multiple-choice set, or null when there is none (an old-shape set counts as none). */
export async function getQuestionSet(courseId: string, unitId: string): Promise<PretestQuestionSet | null> {
  const set = await getDoc<unknown>(setKey(courseId, unitId));
  return isMultipleChoiceSet(set) ? set : null;
}

/** Removes an old-shape set so a multiple-choice one can be written in its place. Never touches a good set. */
export async function discardOldSet(courseId: string, unitId: string): Promise<void> {
  const key = setKey(courseId, unitId);
  const stored = await getDoc<unknown>(key);
  if (stored !== null && !isMultipleChoiceSet(stored)) await deleteDoc(key);
}

export function getRecord(courseId: string, ownerId: string): Promise<PretestRecord | null> {
  return getDoc<PretestRecord>(recordKey(courseId, ownerId));
}

export function saveRecord(record: PretestRecord): Promise<void> {
  return putDoc(recordKey(record.courseId, record.ownerId), record);
}

/** A lock older than this belongs to a request that died (a check call is at most 15 s). */
export const STALE_LOCK_MS = 60_000;

const BUSY = "Your answers are being checked. Give it a few seconds, then try again.";

/** Runs `change` while holding this learner's pre-test lock, so two changes never interleave. */
export async function withLock<T>(courseId: string, ownerId: string, change: () => Promise<T>): Promise<T> {
  const key = lockKey(courseId, ownerId);
  const lock = { at: new Date().toISOString() };
  if (!(await claimDoc(key, lock))) {
    const held = await getDoc<typeof lock>(key);
    const stale = held === null || Date.now() - Date.parse(held.at) > STALE_LOCK_MS;
    if (!stale) throw new HttpError(BUSY, 409);
    await deleteDoc(key);
    if (!(await claimDoc(key, lock))) throw new HttpError(BUSY, 409);
  }
  try {
    return await change();
  } finally {
    await deleteDoc(key).catch(() => undefined);
  }
}

/**
 * For "Delete my data": every pre-test record (and lock) of this person. The canonical question
 * sets hold no learner data and stay. Returns how many records went.
 */
export async function deletePretestData(userId: string): Promise<{ pretests: number }> {
  const keys = (await listKeys(RECORD_PREFIX)).filter((key) => key.split("/")[2] === userId);
  await Promise.all(keys.map((key) => deleteDoc(key)));
  return { pretests: keys.filter((key) => key.split("/").length === 3).length };
}
