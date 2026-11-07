import { describe, expect, it } from "vitest";
import { actionForKey, cardCounter, deckActionForEvent, deckStep, START, targetHandlesKeys } from "./deck";

const key = (k: string, target: unknown = { tagName: "DIV", isContentEditable: false }) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target,
});

describe("deckStep", () => {
  it("flips back and forth", () => {
    const flipped = deckStep(START, "flip", 6);
    expect(flipped).toEqual({ index: 0, flipped: true });
    expect(deckStep(flipped, "flip", 6)).toEqual(START);
  });

  it("moves to the question side of the next or previous card", () => {
    expect(deckStep({ index: 2, flipped: true }, "next", 6)).toEqual({ index: 3, flipped: false });
    expect(deckStep({ index: 2, flipped: true }, "previous", 6)).toEqual({ index: 1, flipped: false });
  });

  it("stays put at either end, keeping the side shown", () => {
    const first = { index: 0, flipped: true };
    const last = { index: 5, flipped: true };
    expect(deckStep(first, "previous", 6)).toBe(first);
    expect(deckStep(last, "next", 6)).toBe(last);
  });
});

describe("keys", () => {
  it("maps Space and Enter to flip, arrows to move, and ignores the rest", () => {
    expect(actionForKey(" ")).toBe("flip");
    expect(actionForKey("Enter")).toBe("flip");
    expect(actionForKey("ArrowLeft")).toBe("previous");
    expect(actionForKey("ArrowRight")).toBe("next");
    expect(actionForKey("ArrowUp")).toBeNull();
    expect(actionForKey("a")).toBeNull();
  });

  it("leaves text boxes, buttons, links and editable areas alone", () => {
    expect(targetHandlesKeys({ tagName: "TEXTAREA" })).toBe(true);
    expect(targetHandlesKeys({ tagName: "input" })).toBe(true);
    expect(targetHandlesKeys({ tagName: "BUTTON" })).toBe(true);
    expect(targetHandlesKeys({ tagName: "A" })).toBe(true);
    expect(targetHandlesKeys({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(targetHandlesKeys({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(targetHandlesKeys(null)).toBe(false);

    expect(deckActionForEvent(key(" ", { tagName: "TEXTAREA" }))).toBeNull();
    expect(deckActionForEvent(key(" "))).toBe("flip");
  });

  it("leaves shortcuts with modifier keys to the browser", () => {
    expect(deckActionForEvent({ ...key("ArrowLeft"), altKey: true })).toBeNull();
    expect(deckActionForEvent({ ...key("ArrowRight"), metaKey: true })).toBeNull();
    expect(deckActionForEvent({ ...key("Enter"), ctrlKey: true })).toBeNull();
  });
});

it("counts cards from one", () => {
  expect(cardCounter(1, 6)).toBe("Card 2 of 6");
});
