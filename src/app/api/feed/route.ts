import { getFeedPage } from "@/features/feed";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// A map with no cards yet gets one model call, at most two maps per page.
export const maxDuration = 60;

/** One page of the "For you" feed. ?cursor= continues it, ?view=saved lists saved cards. A new visitor gets the samples. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const page = await getFeedPage(await readUserId(), {
      cursor: params.get("cursor"),
      savedOnly: params.get("view") === "saved",
    });
    return Response.json(page);
  } catch (error) {
    return errorResponse(error, "The feed could not be loaded just now. Please try again.");
  }
}
