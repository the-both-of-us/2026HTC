import {
  flashcardsErrorResponse,
  getOrCreateFlashcards,
  getSavedFlashcards,
  parseFlashcardsBody,
  parseFlashcardsQuery,
} from "@/features/flashcards";
import { getUserId } from "@/shared/identity";

// One model call, which the AI module may retry on another provider.
export const maxDuration = 60;

/**
 * The saved cards for a skill, or { items: null }. Never calls the model. A private map
 * is a 404 for everyone but its owner, the same as a missing one.
 */
export async function GET(request: Request) {
  try {
    const { mapId, nodeId } = parseFlashcardsQuery(request.url);
    const viewerId = await getUserId();
    const items = await getSavedFlashcards(mapId, nodeId, viewerId);
    return Response.json({ items });
  } catch (error) {
    return flashcardsErrorResponse(error);
  }
}

/** The saved cards, or new ones made and saved now. Same 404s as GET. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseFlashcardsBody(request);
    const viewerId = await getUserId();
    const items = await getOrCreateFlashcards(mapId, nodeId, viewerId);
    return Response.json({ items });
  } catch (error) {
    return flashcardsErrorResponse(error);
  }
}
