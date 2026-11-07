import { HttpError } from "@/shared/http";

/** A problem we can explain to the user. The message is safe to show them. */
export class NetworkError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "NetworkError";
  }
}

export const SIGN_IN_TO_JOIN = "Sign in to join the network, so people know it's really you.";
