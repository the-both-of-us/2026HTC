import { getSkillMap, toPublicMap } from "@/features/skill-map";
import { readUserId } from "@/shared/identity";
import { canReadMap } from "./access";

/** A map is readable by its owner, and by anyone once it is published as a course. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const map = await getSkillMap(id);
    if (!map) {
      return Response.json(
        { error: "We could not find that map. Check the link, or build a new one." },
        { status: 404 },
      );
    }
    if (!(await canReadMap(map, await readUserId()))) {
      return Response.json(
        { error: "This map is private, so only the person who built it can open it. You can build your own from a job posting." },
        { status: 403 },
      );
    }
    return Response.json(toPublicMap(map));
  } catch (error) {
    console.error("[maps] could not read a map", error);
    return Response.json(
      { error: "The map could not be loaded right now. Please try again." },
      { status: 500 },
    );
  }
}
