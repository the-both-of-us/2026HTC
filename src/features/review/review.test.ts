import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import { deleteUserData } from "./deleteData";
import { CARD_NOT_FOUND, ReviewError } from "./errors";
import { getReviewQueue, getReviewSummary, gradeCard, listReviewActivity } from "./review";
import { logKey } from "./storage";
import { resetStore, saveDeck, saveMap } from "./testing";
import type { ReviewCard } from "./types";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

const ME = randomUUID();
const OTHER = randomUUID();
const T0 = new Date("2026-11-07T12:00:00.000Z");
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function caught(promise: Promise<unknown>): Promise<ReviewError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ReviewError);
  return error as ReviewError;
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  resetStore();
  vi.mocked(chatJSON).mockReset();
});

describe("review queue", () => {
  it("collects saved cards from the viewer's own maps only, including copies, and never calls the model", async () => {
    const mine = await saveMap(ME, { title: "Mine" });
    const copy = await saveMap(ME, { title: "Copy", forkedFrom: randomUUID() });
    const theirs = await saveMap(OTHER, { title: "Theirs" });
    await saveDeck(mine.id, "a", 3);
    await saveDeck(copy.id, "b", 2);
    await saveDeck(theirs.id, "a", 4);

    const result = await getReviewQueue(ME, T0);
    expect(result).toMatchObject({ dueCount: 0, newCount: 5, totalCards: 5, nextDueAt: null });
    expect(new Set(result.queue.map((item) => item.mapTitle))).toEqual(new Set(["Mine", "Copy"]));
    expect(result.queue[0]).toMatchObject({ skillTitle: expect.stringMatching(/^Skill /), isNew: true });
    expect(JSON.stringify(result)).not.toContain(ME);
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("is empty for a viewer with no maps or no flashcards", async () => {
    await saveMap(ME);
    expect(await getReviewQueue(ME, T0)).toEqual({ queue: [], dueCount: 0, newCount: 0, moreNew: 0, totalCards: 0, nextDueAt: null });
    expect(await getReviewQueue(randomUUID(), T0)).toMatchObject({ totalCards: 0 });
  });
});

describe("gradeCard", () => {
  it("applies SM-2, saves the state and moves the card out of the queue until it is due", async () => {
    const map = await saveMap(ME);
    const [first, second] = await saveDeck(map.id, "a", 2);

    const schedule = await gradeCard(ME, { mapId: map.id, nodeId: "a", cardId: first, grade: "good" }, T0);
    expect(schedule).toEqual({ dueAt: "2026-11-08T12:00:00.000Z", intervalDays: 1 });

    const saved = await getDoc<ReviewCard>(`review/${ME}/${first}`);
    expect(saved).toMatchObject({ cardId: first, mapId: map.id, nodeId: "a", repetitions: 1, lapses: 0, ease: 2.5 });
    expect(saved).not.toHaveProperty("ownerId");

    expect(await getReviewSummary(ME, later(1))).toEqual({
      dueCount: 0,
      newCount: 1,
      moreNew: 0,
      totalCards: 2,
      nextDueAt: "2026-11-08T12:00:00.000Z",
    });
    const tomorrow = await getReviewQueue(ME, new Date("2026-11-08T12:00:00.000Z"));
    expect(tomorrow.queue.map((item) => item.cardId)).toEqual([first, second]);
    expect(tomorrow.queue[0]).toMatchObject({ isNew: false, intervals: { good: 6 } });
  });

  it("brings an Again card back in 10 minutes", async () => {
    const map = await saveMap(ME);
    const [card] = await saveDeck(map.id, "a", 1);
    expect(await gradeCard(ME, { mapId: map.id, nodeId: "a", cardId: card, grade: "again" }, T0)).toEqual({
      dueAt: "2026-11-07T12:10:00.000Z",
      intervalDays: 0,
    });
    expect(await getReviewSummary(ME, later(10))).toMatchObject({ dueCount: 1, newCount: 0 });
  });

  it("answers someone else's map, a missing map, a missing skill and a card not in the deck with one 404", async () => {
    const mine = await saveMap(ME);
    const theirs = await saveMap(OTHER);
    const [myCard] = await saveDeck(mine.id, "a", 1);
    const [theirCard] = await saveDeck(theirs.id, "a", 1);
    const [otherSkillCard] = await saveDeck(mine.id, "b", 1);

    const attempts = [
      { mapId: theirs.id, nodeId: "a", cardId: theirCard },
      { mapId: randomUUID(), nodeId: "a", cardId: myCard },
      { mapId: "not-a-uuid", nodeId: "a", cardId: myCard },
      { mapId: mine.id, nodeId: "zzz", cardId: myCard },
      { mapId: mine.id, nodeId: "a", cardId: theirCard },
      { mapId: mine.id, nodeId: "a", cardId: otherSkillCard },
      { mapId: mine.id, nodeId: "a", cardId: "../../maps/x" },
    ];
    for (const attempt of attempts) {
      const error = await caught(gradeCard(ME, { ...attempt, grade: "good" }, T0));
      expect(error.status).toBe(404);
      expect(error.message).toBe(CARD_NOT_FOUND);
    }
    // The owner of the other map can't grade the card through my map either, and nothing was saved.
    await caught(gradeCard(OTHER, { mapId: mine.id, nodeId: "a", cardId: myCard, grade: "good" }, T0));
    expect(await listKeys("review/")).toEqual([]);
  });

  it("refuses a skill with no deck yet", async () => {
    const map = await saveMap(ME);
    const error = await caught(gradeCard(ME, { mapId: map.id, nodeId: "a", cardId: randomUUID(), grade: "good" }, T0));
    expect(error.status).toBe(404);
  });
});

describe("review activity", () => {
  it("keeps every day reviewed, even after a card is reviewed again, in a per-day log", async () => {
    const map = await saveMap(ME);
    const [card] = await saveDeck(map.id, "a", 1);
    const day1 = new Date("2026-11-05T09:00:00.000Z");
    const day1b = new Date("2026-11-05T20:00:00.000Z");
    const day2 = new Date("2026-11-07T10:00:00.000Z");
    for (const now of [day1, day1b, day2]) {
      await gradeCard(ME, { mapId: map.id, nodeId: "a", cardId: card, grade: "good" }, now);
    }

    expect(await getDoc(logKey(ME, "2026-11-05"))).toEqual({
      count: 2,
      firstAt: day1.toISOString(),
      lastAt: day1b.toISOString(),
    });
    expect(await getDoc(logKey(ME, "2026-11-07"))).toMatchObject({ count: 1 });
    expect(await listReviewActivity(ME)).toEqual([day1.toISOString(), day1b.toISOString(), day2.toISOString()]);
    expect(await listReviewActivity(ME, new Date("2026-11-06T00:00:00.000Z"))).toEqual([day2.toISOString()]);
    // Log documents are never mistaken for cards.
    expect(await getReviewSummary(ME, day2)).toMatchObject({ totalCards: 1, dueCount: 0, newCount: 0 });
  });

  it("is empty for someone who never reviewed", async () => {
    expect(await listReviewActivity(ME)).toEqual([]);
    expect(await listReviewActivity("not-a-uuid")).toEqual([]);
  });
});

describe("deleteUserData", () => {
  it("removes every review document for that user only, and can run twice", async () => {
    const map = await saveMap(ME);
    const [card] = await saveDeck(map.id, "a", 1);
    await gradeCard(ME, { mapId: map.id, nodeId: "a", cardId: card, grade: "good" }, T0);
    await putDoc(`review/${OTHER}/${randomUUID()}`, { cardId: "x" });

    expect(await deleteUserData(ME)).toEqual({ reviewRecords: 2 });
    expect(await listKeys(`review/${ME}/`)).toEqual([]);
    expect(await listKeys(`review/${OTHER}/`)).toHaveLength(1);
    expect(await deleteUserData(ME)).toEqual({ reviewRecords: 0 });
  });

  it("accepts only UUIDs", async () => {
    await putDoc(`review/${OTHER}/${randomUUID()}`, { cardId: "x" });
    expect(await deleteUserData("")).toEqual({ reviewRecords: 0 });
    expect(await deleteUserData("../")).toEqual({ reviewRecords: 0 });
    expect(await listKeys("review/")).toHaveLength(1);
  });
});
