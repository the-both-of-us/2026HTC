import { after } from "next/server";
import { getFeedPage, parseFormat } from "@/features/feed";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// A typed interest's first batch may be written during the request (one model call, at most
// 30 s), and a pool top-up then runs in after(), which shares this budget (Next docs: after "will
// run for the platform's default or configured max duration of your route"). 60 s could cut it off.
export const maxDuration = 120;

/**
 * One page of the feed. ?exclude= lists the item ids already on screen (comma-separated), and
 * ?view=saved lists saved items, and ?format=both|videos|text picks the kind. A viewer with no interests gets `needsInterests`.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const exclude = (params.get("exclude") ?? "").slice(0, 8000).split(",").filter(Boolean);
    const page = await getFeedPage(await readUserId(), {
      savedOnly: params.get("view") === "saved",
      format: parseFormat(params.get("format")),
      exclude,
      schedule: (task) => after(task),
    });
    return Response.json(page);
  } catch (error) {
    return errorResponse(error, "The feed could not be loaded just now. Please try again.");
  }
}
