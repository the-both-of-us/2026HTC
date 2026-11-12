import { deleteSkillMap, getSkillMap, syncCourseMap, toPublicMap, type MapResponse } from "@/features/skill-map";
import { readUserId } from "@/shared/identity";
import { canReadMap } from "./access";

// No model call in the request, but appending unit 1 starts unit 2's canonical build after the response.
export const maxDuration = 120;

/**
 * A map is readable only by its owner. For a map of a catalog course the reply carries the
 * attached syllabus (planning while it is written) and `build`; unit 1 is appended as soon as it
 * exists (zero model calls).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const stored = await getSkillMap(id);
    if (!stored) {
      return Response.json(
        { error: "We could not find that map. Check the link, or build a new one." },
        { status: 404 },
      );
    }
    const viewerId = await readUserId();
    if (!canReadMap(stored, viewerId)) {
      return Response.json(
        { error: "This map is private, so only the person who built it can open it. You can build your own from a job posting." },
        { status: 403 },
      );
    }
    const { map, build } = await syncCourseMap(stored);
    return Response.json(toPublicMap(map, build) satisfies MapResponse);
  } catch (error) {
    console.error("[maps] could not read a map", error);
    return Response.json(
      { error: "The map could not be loaded right now. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * Deletes your own map. Study circle copies other learners made stay theirs. A course inside a
 * program is deleted with the program, not alone.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const map = await getSkillMap(id);
    if (!map) return Response.json({ error: "That course is already gone." }, { status: 404 });
    const userId = await readUserId();
    if (!userId || map.ownerId !== userId) {
      return Response.json({ error: "Only the person who built this course can delete it." }, { status: 403 });
    }
    if (map.program) {
      return Response.json(
        { error: "This course is part of a program, so it stays while the program does." },
        { status: 409 },
      );
    }
    await deleteSkillMap(id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[maps] could not delete a map", error);
    return Response.json({ error: "The course could not be deleted right now. Please try again." }, { status: 500 });
  }
}
