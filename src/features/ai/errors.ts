/** Thrown when the AI could not answer. The message is safe to show to a user. */
export class AiUnavailableError extends Error {
  constructor() {
    super("The AI is unavailable right now. Please try again in a moment.");
    this.name = "AiUnavailableError";
  }
}

/** Thrown when the model declined the request (`stop_reason: "refusal"`). The message is safe to show. */
export class AiRefusedError extends Error {
  constructor() {
    super("We can't write this topic here.");
    this.name = "AiRefusedError";
  }
}
