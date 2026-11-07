import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQueue, readQueue, sendGrade } from "./api";
import type { QueueItem } from "../types";

const item: QueueItem = {
  cardId: "c",
  mapId: "m",
  nodeId: "n",
  front: "Q",
  back: "A",
  mapTitle: "Map",
  skillTitle: "Skill",
  isNew: true,
  intervals: { again: 0, hard: 1, good: 1, easy: 2 },
};
const queueBody = { queue: [item], dueCount: 0, newCount: 1, moreNew: 0, totalCards: 1, nextDueAt: null };

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review api helpers", () => {
  it("accepts a well-formed queue and refuses anything else", () => {
    expect(readQueue(queueBody)).toEqual({ queue: queueBody });
    expect(readQueue({ ...queueBody, queue: [{ ...item, intervals: {} }] })).toBeNull();
    expect(readQueue({ ...queueBody, totalCards: "1" })).toBeNull();
    expect(readQueue({ ...queueBody, moreNew: undefined })).toBeNull();
    expect(readQueue(null)).toBeNull();
  });

  it("returns the queue, or the server's sentence on failure", async () => {
    respond(200, queueBody);
    expect(await fetchQueue()).toMatchObject({ ok: true, queue: { totalCards: 1 } });
    respond(500, { error: "Something specific." });
    expect(await fetchQueue()).toEqual({ ok: false, message: "Something specific.", status: 500 });
  });

  it("posts a grade with only the card's ids and reads the schedule", async () => {
    respond(200, { dueAt: "2026-11-08T12:00:00.000Z", intervalDays: 1 });
    expect(await sendGrade(item, "good")).toEqual({
      ok: true,
      schedule: { dueAt: "2026-11-08T12:00:00.000Z", intervalDays: 1 },
    });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ mapId: "m", nodeId: "n", cardId: "c", grade: "good" });
  });

  it("turns a network failure or a platform page into a sentence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await sendGrade(item, "good")).toMatchObject({ ok: false, message: expect.stringContaining("could not be reached") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    expect(await sendGrade(item, "good")).toMatchObject({ ok: false, message: "Please answer it again." });
  });
});
