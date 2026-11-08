import {
  createInvite,
  networkErrorResponse,
  parseInviteBody,
} from "@/features/network";
import { getUserId } from "@/shared/identity";

/** Your invite code for /people/invite/<code>: the same each time, or a new one with `{fresh: true}`. */
export async function POST(request: Request) {
  try {
    const { fresh } = await parseInviteBody(request);
    return Response.json(await createInvite(await getUserId(), fresh));
  } catch (error) {
    return networkErrorResponse(error);
  }
}
