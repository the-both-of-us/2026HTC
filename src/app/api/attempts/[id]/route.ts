import { errorResponse, getOwnAttempt, toLearnerView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await getUserId();
    return Response.json(toLearnerView(await getOwnAttempt(userId, id)));
  } catch (error) {
    return errorResponse(error);
  }
}
