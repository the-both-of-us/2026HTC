import type { OwnerProofView } from "../types";

/** Calls our API and returns the JSON, or throws an Error with a sentence fit to show. */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("We could not reach OryxLearn. Check your connection and try again.");
  }

  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) {
    throw new Error(body?.error ?? "Something went wrong on our side. Please try again.");
  }
  return body;
}

type ProofReply = { proof: OwnerProofView | null };

export async function loadOwnProof(mapId: string): Promise<OwnerProofView | null> {
  const { proof } = await requestJson<ProofReply>(`/api/proof?mapId=${encodeURIComponent(mapId)}`);
  return proof;
}

export async function publish(mapId: string, displayName: string): Promise<OwnerProofView | null> {
  const { proof } = await requestJson<ProofReply>("/api/proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapId, displayName }),
  });
  return proof;
}

export async function withdraw(proofId: string): Promise<OwnerProofView | null> {
  const { proof } = await requestJson<ProofReply>(`/api/proof/${encodeURIComponent(proofId)}`, { method: "DELETE" });
  return proof;
}

export type VerifyReply =
  | {
      state: "live";
      hashMatches: boolean;
      sealMatches: boolean | null;
      storedHash: string;
      recomputedHash: string;
      quotes: { verified: number; total: number };
      scores: { matching: number; total: number };
      /** Missing for an older record whose exact text would show a catch round. */
      canonical?: string;
    }
  | { state: "revoked"; revokedAt: string };

export function verifyProof(proofId: string): Promise<VerifyReply> {
  return requestJson<VerifyReply>(`/api/proof/${encodeURIComponent(proofId)}/verify`, { cache: "no-store" });
}

/** SHA-256 in this browser, or null where the browser does not offer it (plain http). */
export async function sha256InBrowser(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
