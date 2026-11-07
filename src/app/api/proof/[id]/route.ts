import { ProofError, proofErrorResponse, revokeProof, toOwnerView } from "@/features/proof";
import { readUserId } from "@/shared/identity";

/** Withdraws the page. Only its owner can do this. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const userId = await readUserId();
    if (!userId) throw new ProofError("Only the person who published this page can withdraw it.", 403);
    const record = await revokeProof(userId, id);
    return Response.json({ proof: toOwnerView(record) });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
