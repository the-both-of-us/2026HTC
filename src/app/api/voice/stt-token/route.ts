import { handleSttToken } from "@/features/voice";
import { getUserId } from "@/shared/identity";

export async function POST(request: Request) {
  return handleSttToken(request, await getUserId());
}
