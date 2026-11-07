import type { PublicSkillMap } from "../storage";

export type MapLoadResult =
  | { kind: "found"; map: PublicSkillMap; proven: Record<string, string>; isOwner: boolean }
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

/** Which nodes are proven: node id to the attempt that proved it. */
export async function fetchProven(mapId: string): Promise<Record<string, string>> {
  return (await fetchProgress(mapId)).proven;
}

async function fetchProgress(
  mapId: string,
  signal?: AbortSignal,
): Promise<{ proven: Record<string, string>; isOwner: boolean }> {
  const response = await fetch(`${mapUrl(mapId)}/progress`, { signal });
  // Only a map's owner can read its progress. Anyone else with the link sees a fresh map.
  if (response.status === 403) return { proven: {}, isOwner: false };
  if (response.status === 404) return { proven: {}, isOwner: true };
  if (!response.ok) throw new Error(`Progress request failed: ${response.status}`);

  const progress = (await response.json()) as { proven?: Record<string, string> };
  return { proven: progress.proven ?? {}, isOwner: true };
}
