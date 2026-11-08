import { aiSettingsInputSchema, getAiSettings, saveAiSettings } from "@/features/settings";
import { errorResponse, parseBody } from "@/shared/http";
import { getSession, getUserId } from "@/shared/identity";

/** The learner's AI settings. A visitor with no cookie yet gets the defaults, and no cookie is made. */
export async function GET() {
  try {
    const { userId } = await getSession();
    return Response.json({ settings: await getAiSettings(userId) });
  } catch (error) {
    return errorResponse(error, "Your settings could not be loaded just now. Please try again.");
  }
}

/** Saves the AI settings: { speed, overrides }. Every route that calls a model reads them back server-side. */
export async function PUT(request: Request) {
  try {
    const input = await parseBody(request, aiSettingsInputSchema);
    const settings = await saveAiSettings(await getUserId(), input);
    return Response.json({ settings });
  } catch (error) {
    return errorResponse(error, "Your settings could not be saved just now. Please try again.");
  }
}
