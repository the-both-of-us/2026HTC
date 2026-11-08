import { getUserId } from "@/shared/identity";
import {
  getNetwork,
  joinNetwork,
  leaveNetwork,
  networkErrorResponse,
  parseProfileBody,
  parseVisibilityBody,
  setInNetwork,
  setPrivacySettings,
} from "@/features/network";

/** The network as this viewer sees it: their profile, who could mentor them, and everyone else. */
export async function GET() {
  try {
    const userId = await getUserId();
    return Response.json(await getNetwork(userId));
  } catch (error) {
    return networkErrorResponse(error);
  }
}

/** Joins the network, or updates your profile. */
export async function PUT(request: Request) {
  try {
    const input = await parseProfileBody(request);
    const userId = await getUserId();
    return Response.json({ me: await joinNetwork(userId, input) });
  } catch (error) {
    return networkErrorResponse(error);
  }
}

/**
 * Opts in to the network (`{inNetwork: true}`) or out of it, keeping your friends, and/or
 * saves the friends and privacy settings (`shareProgress`, `allowRequests`, `allowPings`).
 */
export async function PATCH(request: Request) {
  try {
    const { inNetwork, ...privacy } = await parseVisibilityBody(request);
    const userId = await getUserId();
    let me = inNetwork === undefined ? null : await setInNetwork(userId, inNetwork);
    if (Object.keys(privacy).length > 0) me = await setPrivacySettings(userId, privacy);
    return Response.json({ me });
  } catch (error) {
    return networkErrorResponse(error);
  }
}

/** Deletes your profile, your friend links and your invite link. */
export async function DELETE() {
  try {
    const userId = await getUserId();
    await leaveNetwork(userId);
    return Response.json({ ok: true });
  } catch (error) {
    return networkErrorResponse(error);
  }
}
