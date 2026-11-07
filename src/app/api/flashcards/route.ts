import {
  flashcardsErrorResponse,
  getOrCreateFlashcards,
  getSavedFlashcards,
  parseFlashcardsBody,
  parseFlashcardsQuery,
} from "@/features/flashcards";

// One model call, which the AI module may retry on another provider.
export const maxDuration = 60;

/** The saved cards for a skill, or { items: null }. Never calls the model. */
export async function GET(request: Request) {
  try {
    const { mapId, nodeId } = parseFlashcardsQuery(request.url);
    const items = await getSavedFlashcards(mapId, nodeId);
    return Response.json({ items });
  } catch (error) {
    return flashcardsErrorResponse(error);
  }
}

/** The saved cards, or new ones made and saved now. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseFlashcardsBody(request);
    const items = await getOrCreateFlashcards(mapId, nodeId);
    return Response.json({ items });
  } catch (error) {
    return flashcardsErrorResponse(error);
  }
}
