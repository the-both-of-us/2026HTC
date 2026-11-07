import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc } from "@/shared/store";
import { isPublished, publishCourse, unpublishCourse } from "./courses";
import { likeCourse } from "./likes";
import { resetStore, saveMap } from "./testing";
import type { CourseListing } from "./types";

/**
 * Pauses a like request at its Nth read of the listing, so the owner can unpublish or
 * republish in that gap. On Vercel Blob every read and write is a network round trip,
 * so the gap is real.
 */
const gate = {
  key: "",
  pauseAt: 0,
  reads: 0,
  reached: null as null | (() => void),
  release: null as null | (() => void),
};

vi.mock("@/shared/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/store")>();
  return {
    ...real,
    getDoc: async <T,>(key: string): Promise<T | null> => {
      const value = await real.getDoc<T>(key);
      if (gate.pauseAt > 0 && key === gate.key) {
        gate.reads += 1;
        if (gate.reads === gate.pauseAt) {
          gate.reached?.();
          await new Promise<void>((resolve) => (gate.release = resolve));
        }
      }
      return value;
    },
  };
});

const OWNER = randomUUID();
const FAN = randomUUID();

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  resetStore();
  Object.assign(gate, { key: "", pauseAt: 0, reads: 0, reached: null, release: null });
});

/**
 * Starts a like, pauses it at its Nth read of the listing and runs `between` there. When the
 * like never reads the listing that many times, there is no gap, so `between` runs after it
 * instead, and this returns false.
 */
async function likeWithGap(mapId: string, pauseAt: number, between: () => Promise<void>): Promise<boolean> {
  const reached = new Promise<void>((resolve) => (gate.reached = resolve));
  Object.assign(gate, { key: `courses/${mapId}`, pauseAt, reads: 0 });
  const like = likeCourse(mapId, FAN);
  const paused = await Promise.race([reached.then(() => true), like.then(() => false)]);
  if (paused) {
    gate.pauseAt = 0;
    await between();
    gate.release?.();
  }
  await like;
  if (!paused) {
    gate.pauseAt = 0;
    await between();
  }
  return paused;
}

describe("a like that overlaps the owner's change", () => {
  // Every read of the listing a like makes is a possible gap, so try each of them.
  for (const pauseAt of [1, 2, 3]) {
    it(`never makes an unpublished course public again (pause at read ${pauseAt})`, async () => {
      const map = await saveMap(OWNER);
      await publishCourse(map.id, OWNER, "Owner");

      await likeWithGap(map.id, pauseAt, async () => {
        await unpublishCourse(map.id, OWNER);
        expect(await isPublished(map.id)).toBe(false);
      });

      expect(await isPublished(map.id)).toBe(false);
      expect(await getDoc(`courses/${map.id}`)).toBeNull();
    });

    it(`never undoes a republish's new name (pause at read ${pauseAt})`, async () => {
      const map = await saveMap(OWNER);
      await publishCourse(map.id, OWNER, "Old name");

      await likeWithGap(map.id, pauseAt, async () => {
        await publishCourse(map.id, OWNER, "New name");
      });

      expect((await getDoc<CourseListing>(`courses/${map.id}`))?.authorName).toBe("New name");
    });
  }

  it("pauses at least once, so the tests above really interleave", async () => {
    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER, "Owner");
    expect(await likeWithGap(map.id, 1, async () => {})).toBe(true);
  });
});
