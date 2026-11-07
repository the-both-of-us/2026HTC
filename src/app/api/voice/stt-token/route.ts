import { handleSttToken } from "@/features/voice";
import { readUserId } from "@/shared/identity";

export async function POST(request: Request) {
  // readUserId, not getUserId: a caller with no cookie must not be handed a new identity here.
  return handleSttToken(request, await readUserId());
}
