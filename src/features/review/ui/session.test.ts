import { describe, expect, it } from "vitest";
import type { QueueItem } from "../types";
import { cardCounter, dueIn, earliest, keyAction, remainingLabel, type KeyEventLike } from "./session";

const key = (k: string, target: unknown = { tagName: "DIV" }, extra: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target,
  ...extra,
});

describe("keyAction", () => {
  it("shows the answer with Space or Enter on the card, before it is revealed", () => {
    expect(keyAction(key(" "), false)).toEqual({ kind: "reveal" });
    expect(keyAction(key("Enter"), false)).toEqual({ kind: "reveal" });
    expect(keyAction(key("1"), false)).toBeNull();
  });

  it("leaves Space and Enter to a focused button or link", () => {
    expect(keyAction(key(" ", { tagName: "BUTTON" }), false)).toBeNull();
    expect(keyAction(key("Enter", { tagName: "a" }), false)).toBeNull();
  });

  it("grades with 1 to 4 once revealed, from the card or a grade button", () => {
    expect(keyAction(key("1"), true)).toEqual({ kind: "grade", grade: "again" });
    expect(keyAction(key("2", { tagName: "BUTTON" }), true)).toEqual({ kind: "grade", grade: "hard" });
    expect(keyAction(key("3"), true)).toEqual({ kind: "grade", grade: "good" });
    expect(keyAction(key("4"), true)).toEqual({ kind: "grade", grade: "easy" });
    expect(keyAction(key("5"), true)).toBeNull();
    expect(keyAction(key(" "), true)).toBeNull();
  });

  it("never takes keys from text boxes, editable content or shortcuts", () => {
    for (const target of [{ tagName: "INPUT" }, { tagName: "textarea" }, { tagName: "SELECT" }, { isContentEditable: true }]) {
      expect(keyAction(key("1", target), true)).toBeNull();
      expect(keyAction(key(" ", target), false)).toBeNull();
    }
    expect(keyAction(key("1", undefined, { metaKey: true }), true)).toBeNull();
    expect(keyAction(key(" ", undefined, { ctrlKey: true }), false)).toBeNull();
  });
});

describe("labels", () => {
  const item = (isNew: boolean) => ({ isNew }) as QueueItem;

  it("counts what is left", () => {
    expect(cardCounter(2, 12)).toBe("Card 3 of 12");
    expect(remainingLabel([item(false), item(false), item(true)])).toBe("2 cards due · 1 new");
    expect(remainingLabel([item(false)])).toBe("1 card due · 0 new");
  });

  it("says when the next card is due in elapsed time", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    expect(dueIn("2026-11-07T12:10:00.000Z", now)).toBe("in 10 minutes");
    expect(dueIn("2026-11-07T15:00:00.000Z", now)).toBe("in 3 hours");
    expect(dueIn("2026-11-13T12:00:00.000Z", now)).toBe("in 6 days");
    expect(dueIn("2026-11-07T11:00:00.000Z", now)).toBe("now");
    expect(dueIn("nonsense", now)).toBe("now");
  });

  it("keeps the soonest due time", () => {
    expect(earliest(null, "b")).toBe("b");
    expect(earliest("2026-11-08T00:00:00.000Z", "2026-11-07T00:00:00.000Z")).toBe("2026-11-07T00:00:00.000Z");
    expect(earliest(null, null)).toBeNull();
  });
});
