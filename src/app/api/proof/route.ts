import {
  getOwnProofForMap,
  parsePublishBody,
  ProofError,
  proofErrorResponse,
  publishProof,
  toOwnerView,
} from "@/features/proof";
import { readUserId } from "@/shared/identity";

/** The owner's own page for a map, if any: GET /api/proof?mapId=... */
export async function GET(request: Request) {
  try {
    const mapId = new URL(request.url).searchParams.get("mapId") ?? "";
    const record = await getOwnProofForMap(await requireUser(), mapId);
    return Response.json({ proof: record ? toOwnerView(record) : null });
  } catch (error) {
    return proofErrorResponse(error);
  }
}

/** Publishes the page, or updates the existing one. */
export async function POST(request: Request) {
  try {
    const { mapId, displayName } = await parsePublishBody(request);
    const record = await publishProof(await requireUser(), mapId, displayName);
    return Response.json({ proof: toOwnerView(record) });
  } catch (error) {
    return proofErrorResponse(error);
  }
}

/** Both need the cookie that owns the map, so a visitor without one gets the same answer as for a missing map. */
async function requireUser(): Promise<string> {
  const userId = await readUserId();
  if (!userId) throw new ProofError("We could not find that map. Open it in the browser you built it in.", 404);
  return userId;
}
