import { AiUnavailableError } from "@/features/ai";
import { generateSkillMap, SkillMapError } from "@/features/skill-map";
import { getUserId } from "@/shared/identity";

// Generation is one long model call, with one retry if the reply is bad.
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";

  try {
    const ownerId = await getUserId();
    const map = await generateSkillMap({ text, kind: "posting", ownerId });
    return Response.json({ id: map.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillMapError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AiUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("[maps] could not create a map", error);
    return Response.json(
      { error: "The map could not be built this time. Please try again." },
      { status: 500 },
    );
  }
}
