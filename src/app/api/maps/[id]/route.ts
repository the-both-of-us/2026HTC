import { getSkillMap, toPublicMap } from "@/features/skill-map";

/** A map is readable by anyone who has its id. */
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
    return Response.json(toPublicMap(map));
  } catch (error) {
    console.error("[maps] could not read a map", error);
    return Response.json(
      { error: "The map could not be loaded right now. Please try again." },
      { status: 500 },
    );
  }
}
