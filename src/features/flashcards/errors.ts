/** A problem we can explain to the user. The message is safe to show them. */
export class FlashcardsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FlashcardsError";
  }
}
