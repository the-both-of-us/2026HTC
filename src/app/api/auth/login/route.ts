import { handleLogin } from "@/features/auth";

/** Sends the visitor to Auth0 to sign in. `?returnTo=/path` says where to come back to. */
export function GET(request: Request) {
  return handleLogin(request);
}
