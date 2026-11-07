import { z } from "zod";
import { joinCircle } from "@/features/circles";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

const body = z.object({ name: z.string().max(200) });

/** Joins the circle with a copy of its map. Joining again returns the same copy. */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { name } = await parseBody(request, body);
    return Response.json(await joinCircle(await getUserId(), code, name));
  } catch (error) {
    return errorResponse(error, "You could not join just now. Please try again.");
  }
}
