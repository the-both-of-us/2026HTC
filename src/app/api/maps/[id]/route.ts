import { isPublished, unpublishCourse } from "@/features/courses";
import { deleteSkillMap, getSkillMap, toPublicMap } from "@/features/skill-map";
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

/**
 * Deletes your own map, and its listing in Courses if it was public. Copies other learners
 * started stay theirs. A course inside a program is deleted with the program, not alone.
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
    if (await isPublished(id)) await unpublishCourse(id, userId);
    await deleteSkillMap(id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[maps] could not delete a map", error);
    return Response.json({ error: "The course could not be deleted right now. Please try again." }, { status: 500 });
  }
}
