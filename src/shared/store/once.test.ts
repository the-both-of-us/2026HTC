import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimDoc, getDoc, listKeys, putDoc } from "./index";
import {
  onceClaimKey,
  oncePartialKey,
  readOnce,
  setOnceTimingForTests,
  startOnce,
  waitForOnce,
  type OnceClaim,
  type OncePartial,
} from "./once";

delete process.env.BLOB_READ_WRITE_TOKEN;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let n = 0;
const freshKey = () => `test-once/${Date.now()}-${n++}`;

beforeEach(() => setOnceTimingForTests({ writeEveryMs: 20, heartbeatEveryMs: 30, deadAfterMs: 200 }));
afterEach(() => setOnceTimingForTests());

describe("startOnce", () => {
  it("runs produce once for concurrent starts, and the others see running, then ready", async () => {
    const key = freshKey();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      await sleep(30);
      return { value: 42 };
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => startOnce(key, produce)));
    const started = results.filter((r) => typeof r === "object");
    expect(started).toHaveLength(1);
    expect(results.filter((r) => r === "running")).toHaveLength(5);
    await (started[0] as { work: Promise<unknown> }).work;
    expect(calls).toBe(1);
    expect(await getDoc(key)).toEqual({ value: 42 });
    expect(await startOnce(key, produce)).toBe("ready");
    // Nothing left behind.
    expect(await getDoc(onceClaimKey(key))).toBeNull();
    expect(await getDoc(oncePartialKey(key))).toBeNull();
  });

  it("lets viewers follow the parts, throttled, with the last part always written", async () => {
    const key = freshKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const result = await startOnce<string[], string>(key, async ({ emit }) => {
      for (const part of ["a", "b", "c"]) await emit(part);
      await gate;
      return ["a", "b", "c"];
    });
    expect(typeof result).toBe("object");
    // First part is written at once; b and c come with the trailing write.
    await sleep(60);
    const read = await readOnce<string[], string>(key);
    expect(read).toMatchObject({ state: "running", parts: ["a", "b", "c"] });
    release();
    await (result as { work: Promise<unknown> }).work;
    expect(await readOnce(key)).toEqual({ state: "ready", value: ["a", "b", "c"] });
  });

  it("restart clears the parts and bumps the attempt", async () => {
    const key = freshKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const result = await startOnce<number, string>(key, async ({ emit, restart }) => {
      await emit("bad");
      await restart();
      await emit("good");
      await gate;
      return 1;
    });
    await sleep(60);
    const read = await readOnce<number, string>(key);
    expect(read).toMatchObject({ state: "running", attempt: 2, parts: ["good"] });
    release();
    await (result as { work: Promise<unknown> }).work;
  });

  it("cleans up after a failure, so the next start runs again", async () => {
    const key = freshKey();
    const first = await startOnce(key, async ({ emit }: { emit: (p: string) => Promise<void> }) => {
      await emit("x");
      throw new Error("model said no");
    });
    await expect((first as { work: Promise<unknown> }).work).rejects.toThrow("model said no");
    expect(await getDoc(onceClaimKey(key))).toBeNull();
    expect(await getDoc(oncePartialKey(key))).toBeNull();
    expect(await readOnce(key)).toEqual({ state: "idle" });

    const second = await startOnce(key, async () => "ok");
    expect(typeof second).toBe("object");
    expect(await (second as { work: Promise<unknown> }).work).toBe("ok");
  });

  it("never rewrites K when another writer stored it first (a writer taken over as dead that finishes late)", async () => {
    const key = freshKey();
    const started = await startOnce(key, async () => {
      // The writer that took over finishes while this one is still running.
      await putDoc(key, { value: "taken over" });
      return { value: "late" };
    });
    expect(typeof started).toBe("object");
    expect(await (started as { work: Promise<unknown> }).work).toEqual({ value: "taken over" });
    expect(await getDoc(key)).toEqual({ value: "taken over" });
    expect(await getDoc(onceClaimKey(key))).toBeNull();
  });

  it("takes over a dead claim once, with the next attempt number", async () => {
    const key = freshKey();
    const old = new Date(Date.now() - 10_000).toISOString();
    await claimDoc(onceClaimKey(key), { startedAt: old, heartbeatAt: old, attempt: 1 } satisfies OnceClaim);
    await putDoc(oncePartialKey(key), { attempt: 1, parts: ["stale"], updatedAt: old } satisfies OncePartial<string>);
    expect(await readOnce(key)).toEqual({ state: "idle" });

    let seenAttempt = 0;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        startOnce(key, async ({ attempt }) => {
          seenAttempt = attempt;
          await sleep(20);
          return "fresh";
        }),
      ),
    );
    const started = results.filter((r) => typeof r === "object");
    expect(started).toHaveLength(1);
    await (started[0] as { work: Promise<unknown> }).work;
    expect(seenAttempt).toBe(2);
    expect(await getDoc(key)).toBe("fresh");
    expect((await listKeys(onceClaimKey(key))).length).toBe(0);
  });

  it("keeps a live claim's heartbeat fresh during a long step", async () => {
    const key = freshKey();
    const result = await startOnce(key, async ({ heartbeat }) => {
      for (let i = 0; i < 8; i++) {
        await sleep(40);
        await heartbeat();
      }
      return "slow";
    });
    await sleep(250);
    // Past deadAfterMs since the start, but the heartbeat keeps it alive.
    expect(await readOnce(key)).toMatchObject({ state: "running" });
    expect(await startOnce(key, async () => "other")).toBe("running");
    await (result as { work: Promise<unknown> }).work;
    expect(await getDoc(key)).toBe("slow");
  });
});

describe("waitForOnce", () => {
  it("returns the value once written, and null when the writer fails", async () => {
    const key = freshKey();
    const ok = await startOnce(key, async () => {
      await sleep(50);
      return "done";
    });
    expect(await waitForOnce<string>(key, { timeoutMs: 1_000, everyMs: 10 })).toBe("done");
    await (ok as { work: Promise<unknown> }).work;

    const bad = freshKey();
    const failing = await startOnce(bad, async () => {
      await sleep(30);
      throw new Error("nope");
    });
    (failing as { work: Promise<unknown> }).work.catch(() => {});
    expect(await waitForOnce<string>(bad, { timeoutMs: 1_000, everyMs: 10 })).toBeNull();
  });

  it("gives up at the timeout", async () => {
    const key = freshKey();
    const slow = await startOnce(key, async () => {
      await sleep(150);
      return 1;
    });
    expect(await waitForOnce(key, { timeoutMs: 40, everyMs: 10 })).toBeNull();
    await (slow as { work: Promise<unknown> }).work;
  });
});
