import { HttpError } from "@/shared/http";

/** A problem we can explain to the user. The message is safe to show them. */
export class FlashcardsError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "FlashcardsError";
  }
}
