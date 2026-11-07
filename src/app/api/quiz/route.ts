import { getOrCreateQuiz, getSavedQuiz, parseBody, parseQuery, quizErrorResponse } from "@/features/quiz";

/** Making a quiz is one model call, which can try more than one provider. */
export const maxDuration = 60;

/** The saved quiz for a skill, or `{ items: null }`. Never calls the model. */
export async function GET(request: Request) {
  try {
    const { mapId, nodeId } = parseQuery(request);
    return Response.json({ items: await getSavedQuiz(mapId, nodeId) });
  } catch (error) {
    return quizErrorResponse(error);
  }
}

/** Returns the saved quiz, or makes and saves one. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseBody(request);
    return Response.json({ items: await getOrCreateQuiz(mapId, nodeId) });
  } catch (error) {
    return quizErrorResponse(error);
  }
}
