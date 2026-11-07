import { getOrCreateQuiz, getSavedQuiz, parseBody, parseQuery, quizErrorResponse } from "@/features/quiz";
import { getUserId } from "@/shared/identity";

/** Making a quiz is one model call, which can try more than one provider. */
export const maxDuration = 60;

/**
 * The saved quiz for a skill, or `{ items: null }`. Never calls the model. A private map
 * is a 404 for everyone but its owner, the same as a missing one.
 */
export async function GET(request: Request) {
  try {
    const { mapId, nodeId } = parseQuery(request);
    const viewerId = await getUserId();
    return Response.json({ items: await getSavedQuiz(mapId, nodeId, viewerId) });
  } catch (error) {
    return quizErrorResponse(error);
  }
}

/** Returns the saved quiz, or makes and saves one. Same 404s as GET. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseBody(request);
    const viewerId = await getUserId();
    return Response.json({ items: await getOrCreateQuiz(mapId, nodeId, viewerId) });
  } catch (error) {
    return quizErrorResponse(error);
  }
}
