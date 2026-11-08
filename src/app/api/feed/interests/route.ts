import { getInterests, saveInterests, saveInterestsBody } from "@/features/feed";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId, readUserId } from "@/shared/identity";

/** The viewer's interests. */
export async function GET() {
  try {
    return Response.json({ interests: await getInterests(await readUserId()) });
  } catch (error) {
    return errorResponse(error, "Your interests could not be loaded. Please try again.");
  }
}

/** Saves the viewer's interests: suggestion slugs, or typed ones that passed /api/feed/interests/check. */
export async function PUT(request: Request) {
  try {
    const { slugs } = await parseBody(request, saveInterestsBody);
    return Response.json({ interests: await saveInterests(await getUserId(), slugs) });
  } catch (error) {
    return errorResponse(error, "Your interests did not save. Please try again.");
  }
}
