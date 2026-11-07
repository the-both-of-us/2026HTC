import { randomBytes } from "node:crypto";
import { listGridSolves } from "@/features/grid";
import { deriveNodeStates, getSkillMap, isEnergyRelated } from "@/features/skill-map";
import { getAttempt, getPassedFinal, getProgress } from "@/features/teachback";
import { deleteDoc, getDoc, listDocs, putDoc } from "@/shared/store";
import type { Attempt, SkillMap } from "@/shared/types";
import { hashSnapshot, sealFor } from "./hash";
import { buildSnapshot } from "./snapshot";
import type { LiveProof, OwnerProofView, ProofRecord, RevokedProof } from "./types";

export const MAX_NAME_LENGTH = 60;

/** 12 random bytes as base64url: 16 characters, far too many to guess. */
const PROOF_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** A problem we can explain to the user. The message is safe to show them. */
export class ProofError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProofError";
  }
}

/**
 * Publishes the owner's proven skills, or updates their existing page. The id stays the
 * same, so a QR code that is already printed keeps working.
 */
export async function publishProof(ownerId: string, mapId: string, displayName: string): Promise<LiveProof> {
  const name = cleanDisplayName(displayName);
  const map = await loadOwnMap(ownerId, mapId);

  const progress = await getProgress(map.id, ownerId);
  const states = deriveNodeStates(map, progress);

  const attempts: Record<string, Attempt | null> = {};
  await Promise.all(
    map.nodes
      .filter((node) => states[node.id] === "proven")
      .map(async (node) => {
        attempts[node.id] = await getAttempt(progress?.proven[node.id] ?? "");
      }),
  );

  // Grid practice is evidence only for a job in the energy sector.
  const gridSolves = isEnergyRelated(map.sourceText) ? await listGridSolves(ownerId) : [];

  const existingId = await getProofIdForMap(map.id);
  const id = existingId ?? randomBytes(12).toString("base64url");

  const snapshot = buildSnapshot({
    proofId: id,
    displayName: name,
    publishedAt: new Date().toISOString(),
    map,
    states,
    attempts,
    gridSolves,
    finalInterview: await getPassedFinal(map.id),
  });
  if (snapshot.skills.length === 0) {
    throw new ProofError("Prove at least one skill first. Then there is something to share.", 400);
  }

  const hash = hashSnapshot(snapshot);
  const record: LiveProof = { state: "live", id, ownerId, mapId: map.id, snapshot, hash, seal: sealFor(hash) };
  await putDoc(proofKey(id), record);
  if (!existingId) await putDoc(indexKey(map.id), { proofId: id });
  return record;
}

/**
 * Takes a page down by removing the public copy. The attempts behind it stay, because the
 * learner's map needs them, so the page must never claim the person's words are gone everywhere.
 */
export async function revokeProof(ownerId: string, proofId: string): Promise<RevokedProof> {
  const record = await getProof(proofId);
  if (!record) throw new ProofError("We could not find that evidence page.", 404);
  if (record.ownerId !== ownerId) throw new ProofError("Only the person who published this page can withdraw it.", 403);
  if (record.state === "revoked") return record;

  const revoked: RevokedProof = {
    state: "revoked",
    id: record.id,
    ownerId: record.ownerId,
    mapId: record.mapId,
    revokedAt: new Date().toISOString(),
  };
  await putDoc(proofKey(record.id), revoked);
  return revoked;
}

/**
 * For "Delete my data": every page this person published is withdrawn first, so it stops
 * showing their words straight away, and then removed with its index entry. Returns how many.
 */
export async function deleteProofsByOwner(ownerId: string): Promise<number> {
  const records = await listDocs<ProofRecord>("proofs/");
  const own = records.filter((record) => record.ownerId === ownerId);

  await Promise.all(own.map((record) => revokeProof(ownerId, record.id)));
  await Promise.all(
    own.map(async (record) => {
      await deleteDoc(proofKey(record.id));
      // The index entry goes only if it points at this page.
      if ((await getProofIdForMap(record.mapId)) === record.id) await deleteDoc(indexKey(record.mapId));
    }),
  );
  return own.length;
}

/** Returns the record, or null. The id comes from a URL, so it must look like one of ours. */
export async function getProof(id: string): Promise<ProofRecord | null> {
  if (!PROOF_ID_PATTERN.test(id)) return null;
  return getDoc<ProofRecord>(proofKey(id));
}

/** The owner's page for this map, if they ever published one. */
export async function getOwnProofForMap(ownerId: string, mapId: string): Promise<ProofRecord | null> {
  const map = await loadOwnMap(ownerId, mapId);
  const id = await getProofIdForMap(map.id);
  return id ? getProof(id) : null;
}

export function toOwnerView(record: ProofRecord): OwnerProofView {
  const live = record.state === "live";
  return {
    id: record.id,
    path: `/proof/${record.id}`,
    state: record.state,
    displayName: live ? record.snapshot.displayName : null,
    provenCount: live ? record.snapshot.skills.length : null,
    totalSkills: live ? record.snapshot.totalSkills : null,
    hash: live ? record.hash : null,
  };
}

/** Tidies the name the person typed, and refuses one that could not be a name. */
export function cleanDisplayName(input: string): string {
  const name = input
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(name)) {
    throw new ProofError("Please enter the name you want employers to see.", 400);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ProofError(`Please keep the name under ${MAX_NAME_LENGTH} characters.`, 400);
  }
  return name;
}

async function loadOwnMap(ownerId: string, mapId: string): Promise<SkillMap> {
  const map = await getSkillMap(mapId);
  // Someone else's map gets the same answer as a missing one, so it doesn't show that the map exists.
  if (!map || map.ownerId !== ownerId) {
    throw new ProofError("We could not find that map. Check the link, or build a new one.", 404);
  }
  return map;
}

async function getProofIdForMap(mapId: string): Promise<string | null> {
  const entry = await getDoc<{ proofId: string }>(indexKey(mapId));
  return entry?.proofId ?? null;
}

function proofKey(id: string): string {
  return `proofs/${id}`;
}

function indexKey(mapId: string): string {
  return `proof-index/${mapId}`;
}
