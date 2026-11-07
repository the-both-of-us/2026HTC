import { connection } from "next/server";
import { getSession } from "@/shared/identity";
import { isAuthConfigured } from "../config";
import { AccountStatus } from "./AccountStatus";

/**
 * AccountStatus with the session read on the server. It reads cookies, so wrap it in
 * <Suspense> where it is placed. Renders nothing when sign-in is not set up. Only
 * signedIn and displayName reach the browser, never the user id.
 */
export async function AccountStatusServer({ returnTo }: { returnTo?: string } = {}) {
  // Decide per request, so a build without the Auth0 values can't freeze it as "off".
  await connection();
  if (!isAuthConfigured()) return null;
  const { signedIn, displayName } = await getSession();
  return <AccountStatus signedIn={signedIn} displayName={signedIn ? displayName : null} returnTo={returnTo} />;
}
