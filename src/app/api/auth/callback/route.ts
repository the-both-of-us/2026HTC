import { handleCallback } from "@/features/auth";

/** Where Auth0 sends the visitor back. Checks the answer, links the account and signs in. */
export function GET(request: Request) {
  return handleCallback(request);
}
