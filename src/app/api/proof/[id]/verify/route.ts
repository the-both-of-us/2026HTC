import { canonicalJson, checkSnapshot, getProof, proofErrorResponse } from "@/features/proof";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public. Recomputes the fingerprint, the quotes and the scores from what is stored right now.
 * `canonical` is the exact text that was fingerprinted, so anyone can hash it themselves.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const record = await getProof(id);
    if (!record) {
      return Response.json({ state: "missing", error: "We could not find that evidence page." }, { status: 404, headers: NO_STORE });
    }
    if (record.state === "revoked") {
      return Response.json({ state: "revoked", revokedAt: record.revokedAt }, { headers: NO_STORE });
    }
    return Response.json(
      {
        state: "live",
        ...checkSnapshot(record.snapshot, record.hash, record.seal),
        algorithm: "SHA-256",
        canonical: canonicalJson(record.snapshot),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return proofErrorResponse(error);
  }
}
