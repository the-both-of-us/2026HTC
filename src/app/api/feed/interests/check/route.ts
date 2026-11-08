import { checkInterest, checkInterestBody } from "@/features/feed";
import { errorResponse, parseBody } from "@/shared/http";

/** Checks a typed interest (rules, then one quick model call, kept for everyone) and returns it tidied. */
export async function POST(request: Request) {
  try {
    const { name } = await parseBody(request, checkInterestBody);
    return Response.json({ interest: await checkInterest(name) });
  } catch (error) {
    return errorResponse(error, "We could not check that topic just now. Please try again.");
  }
}
