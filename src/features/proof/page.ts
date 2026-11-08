import { readUserId } from "@/shared/identity";
import { getProof } from "./publish";
import type { ProofRecord } from "./types";

/**
 * What the public page should do with an id. A withdrawn record is gone for everyone except
 * its owner, who still sees when it was taken down and a way back to the map.
 */
export type ProofPageData = { kind: "show"; record: ProofRecord } | { kind: "gone" } | { kind: "unreadable" };

export async function loadProofPage(id: string, viewerId?: string | null): Promise<ProofPageData> {
  let record: ProofRecord | null;
  try {
    record = await getProof(id);
  } catch (error) {
    console.error("[proof] could not read a record", error);
    return { kind: "unreadable" };
  }
  if (!record) return { kind: "gone" };
  if (record.state === "revoked" && (viewerId === undefined ? await readUserId() : viewerId) !== record.ownerId) {
    return { kind: "gone" };
  }
  return { kind: "show", record };
}

/**
 * For src/proxy.ts: true when /proof/<id> should answer 404. The page streams, so once it starts
 * the status is fixed at 200 (node_modules/next/dist/docs/01-app/02-guides/streaming.md, "The HTTP
 * contract"); the proxy runs first, so it can still set it. A store error is not a 404.
 */
export async function isProofGone(id: string, viewerId: string | null): Promise<boolean> {
  return (await loadProofPage(id, viewerId)).kind === "gone";
}
