import { eventBody, recordFeedEvent } from "@/features/feed";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

/** Records a view (with how long it was on screen), a share or a "Go deeper" tap. Sent with sendBeacon. */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, eventBody);
    await recordFeedEvent(await getUserId(), body);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "That did not save.");
  }
}
