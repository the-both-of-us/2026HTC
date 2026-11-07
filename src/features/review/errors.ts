import { HttpError } from "@/shared/http";

/** A problem we can explain to the user. The message is safe to show them. */
export class ReviewError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "ReviewError";
  }
}

/**
 * The answer for a missing card, and for a card on someone else's map, so nobody can tell
 * which maps or cards exist.
 */
export const CARD_NOT_FOUND =
  "We could not find that flashcard. It may have been removed. Refresh the page to get your current cards.";
