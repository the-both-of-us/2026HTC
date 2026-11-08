import {
  acceptInvite,
  getInvite,
  networkErrorResponse,
  parseAcceptBody,
} from "@/features/network";
import { getUserId } from "@/shared/identity";

type Context = { params: Promise<{ code: string }> };

/** Who sent this invite, and whether the viewer can accept it. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { code } = await params;
    return Response.json(await getInvite(await getUserId(), code));
  } catch (error) {
    return networkErrorResponse(error);
  }
}

/** Accepts the invite: you and its sender become friends. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { code } = await params;
    const { displayName } = await parseAcceptBody(request);
    return Response.json(
      await acceptInvite(await getUserId(), code, displayName),
    );
  } catch (error) {
    return networkErrorResponse(error);
  }
}
