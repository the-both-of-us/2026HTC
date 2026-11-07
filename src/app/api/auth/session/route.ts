import { connection } from "next/server";
import { handleSession } from "@/features/auth";

/** `{available, signedIn, displayName}` for client-rendered pages. Never the user id. */
export async function GET() {
  // Always answered per request, even on a host where sign-in was off at build time.
  await connection();
  return handleSession();
}
