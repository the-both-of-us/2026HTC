import { canonicalJson, checkSnapshot, getProof, proofErrorResponse, toPublicSnapshot } from "@/features/proof";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public. Recomputes the fingerprint, the quotes and the scores from what is stored right now.
 * `canonical` is the exact text that was fingerprinted, so anyone can hash it themselves. It is
 * left out for an older record that still holds a "Catch the mistake" round, because that text
 * would show the planted sentences. The server-side check still covers it.
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
    const canonical = canonicalJson(record.snapshot);
    const safe = canonicalJson(toPublicSnapshot(record.snapshot)) === canonical;
    return Response.json(
      {
        state: "live",
        ...checkSnapshot(record.snapshot, record.hash, record.seal),
        algorithm: "SHA-256",
        ...(safe && { canonical }),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return proofErrorResponse(error);
  }
}
