import { describe, expect, it } from "vitest";
import { createSaveQueue } from "./saves";

function deferred() {
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createSaveQueue", () => {
  it("counts saves until each one settles, so the last answer is never left unsaved silently", async () => {
    const counts: number[] = [];
    const saves = createSaveQueue((count) => counts.push(count));
    const first = deferred();
    const second = deferred();
    const a = saves.add(() => first.promise);
    const b = saves.add(() => second.promise);
    expect(saves.pending()).toBe(2);

    first.resolve(true);
    expect(await a).toBe("saved");
    expect(saves.pending()).toBe(1);

    second.resolve(true);
    expect(await b).toBe("saved");
    expect(saves.pending()).toBe(0);
    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it("runs saves one after another", async () => {
    const order: string[] = [];
    const saves = createSaveQueue();
    const slow = deferred();
    const a = saves.add(async () => {
      order.push("a start");
      const saved = await slow.promise;
      order.push("a end");
      return saved;
    });
    const b = saves.add(async () => {
      order.push("b");
      return true;
    });
    await Promise.resolve();
    expect(order).toEqual(["a start"]);
    slow.resolve(true);
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "a end", "b"]);
  });

  it("drops the saves queued behind a failure, but runs ones added after it", async () => {
    const saves = createSaveQueue();
    const sent: string[] = [];
    const failing = deferred();
    const a = saves.add(() => {
      sent.push("a");
      return failing.promise;
    });
    const b = saves.add(async () => {
      sent.push("b");
      return true;
    });
    failing.resolve(false);
    expect(await a).toBe("failed");
    expect(await b).toBe("dropped");
    expect(saves.pending()).toBe(0);

    expect(
      await saves.add(async () => {
        sent.push("retry");
        return true;
      }),
    ).toBe("saved");
    expect(sent).toEqual(["a", "retry"]);
  });

  it("treats a save that throws as failed", async () => {
    const saves = createSaveQueue();
    expect(await saves.add(() => Promise.reject(new Error("offline")))).toBe("failed");
    expect(saves.pending()).toBe(0);
  });
});
