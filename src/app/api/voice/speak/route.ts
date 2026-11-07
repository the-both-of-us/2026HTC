import { handleSpeak } from "@/features/voice";
import { getUserId } from "@/shared/identity";

// Audio streams for as long as the sentence takes to say.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleSpeak(request, await getUserId());
}
