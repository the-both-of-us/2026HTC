import { getUserId } from "@/shared/identity";
import { getNetwork, joinNetwork, leaveNetwork, networkErrorResponse, parseProfileBody } from "@/features/network";

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

/** Leaves the network, which deletes your profile. */
export async function DELETE() {
  try {
    const userId = await getUserId();
    await leaveNetwork(userId);
    return Response.json({ ok: true });
  } catch (error) {
    return networkErrorResponse(error);
  }
}
