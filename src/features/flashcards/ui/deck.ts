/** Pure logic for the card deck, kept apart from React so it can be tested. */

export type DeckState = { index: number; flipped: boolean };
export type DeckAction = "flip" | "previous" | "next";

export const START: DeckState = { index: 0, flipped: false };

/** Moving never wraps, and always lands on the question side. */
export function deckStep(state: DeckState, action: DeckAction, total: number): DeckState {
  if (action === "flip") return { ...state, flipped: !state.flipped };
  const index = action === "next" ? Math.min(state.index + 1, total - 1) : Math.max(state.index - 1, 0);
  if (index === state.index) return state;
  return { index, flipped: false };
}

/** The keys the focused card answers to. Anything else is left to the browser. */
export function actionForKey(key: string): DeckAction | null {
  switch (key) {
    case " ":
    case "Enter":
      return "flip";
    case "ArrowLeft":
      return "previous";
    case "ArrowRight":
      return "next";
    default:
      return null;
  }
}

/** The parts of a key event the deck looks at, so tests need no DOM. */
export type KeyEventLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: unknown;
};

const OWN_KEYS_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);

/**
 * True when the event's target handles keys itself: a text box, a button, a link
 * or anything editable. The deck must never steal Space from the teach-back box.
 */
export function targetHandlesKeys(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === "string" && OWN_KEYS_TAGS.has(element.tagName.toUpperCase());
}

/** What a key press on the card region should do, or null to leave it alone. */
export function deckActionForEvent(event: KeyEventLike): DeckAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (targetHandlesKeys(event.target)) return null;
  return actionForKey(event.key);
}

export function cardCounter(index: number, total: number): string {
  return `Card ${index + 1} of ${total}`;
}
