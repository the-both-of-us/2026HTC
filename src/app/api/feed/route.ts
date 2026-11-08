import { after } from "next/server";
import { getFeedPage } from "@/features/feed";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// A typed interest's first batch may be written during the request (one model call).
export const maxDuration = 60;

/**
 * One page of the feed. ?exclude= lists the item ids already on screen (comma-separated), and
 * ?view=saved lists saved items. A viewer with no interests gets `needsInterests`.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const exclude = (params.get("exclude") ?? "").slice(0, 8000).split(",").filter(Boolean);
    const page = await getFeedPage(await readUserId(), {
      savedOnly: params.get("view") === "saved",
      exclude,
      schedule: (task) => after(task),
    });
    return Response.json(page);
  } catch (error) {
    return errorResponse(error, "The feed could not be loaded just now. Please try again.");
  }
}
