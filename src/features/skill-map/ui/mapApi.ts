import type { PublicSkillMap } from "../storage";

export type MapLoadResult =
  | {
      kind: "found";
      map: PublicSkillMap;
      proven: Record<string, string>;
      /** Skills the learner unlocked anyway: node id to when. */
      unlocked: Record<string, string>;
      isOwner: boolean;
    }
  | { kind: "missing" };

function mapUrl(mapId: string): string {
  return `/api/maps/${encodeURIComponent(mapId)}`;
}

/** Loads the map and the learner's progress. Throws on a network or server failure. */
export async function fetchMapWithProgress(
  mapId: string,
  signal: AbortSignal,
): Promise<MapLoadResult> {
  const [mapResponse, progress] = await Promise.all([
    fetch(mapUrl(mapId), { signal }),
    fetchProgress(mapId, signal),
  ]);

  if (mapResponse.status === 404) return { kind: "missing" };
  if (!mapResponse.ok) throw new Error(`Map request failed: ${mapResponse.status}`);

  const map = (await mapResponse.json()) as PublicSkillMap;
  return { kind: "found", map, ...progress };
}

/**
 * Just the map, for polling while a catalog course is being built. Returns null when the map is
 * gone, and throws on a network or server failure.
 */
export async function fetchMapOnly(mapId: string, signal: AbortSignal): Promise<PublicSkillMap | null> {
  const response = await fetch(mapUrl(mapId), { signal, cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
  return (await response.json()) as PublicSkillMap;
}

/** Which nodes are proven: node id to the attempt that proved it. */
export async function fetchProven(mapId: string): Promise<Record<string, string>> {
  return (await fetchProgress(mapId)).proven;
}

async function fetchProgress(
  mapId: string,
  signal?: AbortSignal,
): Promise<{ proven: Record<string, string>; unlocked: Record<string, string>; isOwner: boolean }> {
  const response = await fetch(`${mapUrl(mapId)}/progress`, { signal });
  // Only a map's owner has progress. Anyone else with the link gets { isOwner: false } and sees
  // a fresh map. (A server from before that change answered 403.)
  if (response.status === 403) return { proven: {}, unlocked: {}, isOwner: false };
  if (response.status === 404) return { proven: {}, unlocked: {}, isOwner: true };
  if (!response.ok) throw new Error(`Progress request failed: ${response.status}`);

  const progress = (await response.json()) as {
    isOwner?: boolean;
    proven?: Record<string, string>;
    unlocked?: Record<string, string>;
  };
  return { proven: progress.proven ?? {}, unlocked: progress.unlocked ?? {}, isOwner: progress.isOwner !== false };
}

/**
 * "Unlock anyway": opens a locked skill without proving what it builds on. Returns the
 * skills now unlocked anyway. Throws an Error whose message is a sentence for people.
 */
export async function unlockSkill(mapId: string, nodeId: string): Promise<Record<string, string>> {
  let response: Response;
  try {
    response = await fetch(`${mapUrl(mapId)}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId }),
    });
  } catch {
    throw new Error("We could not reach OryxLearn. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => null)) as { unlocked?: Record<string, string>; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? "The skill could not be unlocked this time. Please try again.");
  return body?.unlocked ?? {};
}
