import { getMapHabits, getStreak } from "@/features/streaks";
import { getSession, getUserId } from "@/shared/identity";
import { errorResponse } from "@/shared/http";

/**
 * The learner's streak, for the sidebar's flame. With ?mapId, also that map's topic of the day
 * and how far each proved topic has faded. The sidebar never creates a guest: no cookie, no streak.
 */
export async function GET(request: Request) {
  try {
    const mapId = new URL(request.url).searchParams.get("mapId");
    if (mapId) return Response.json(await getMapHabits(await getUserId(), mapId));

    const { userId } = await getSession();
    return Response.json({ streak: userId ? await getStreak(userId) : null });
  } catch (error) {
    return errorResponse(error, "Your streak could not be loaded just now. Please try again.");
  }
}
