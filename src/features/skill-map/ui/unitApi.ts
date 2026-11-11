/**
 * "Start unit": `POST /api/maps/[id]/units/[unitId]` (no body). The reply follows
 * `StartUnitResponse` in programs/types.ts:
 * - 200 `{ status: "ready", mapId, unitId }`: the unit's topics are in the map now;
 * - 202 `{ status: "building", building: true }`: another request is building a unit of this map;
 * - 409 while the unit before is less than half proved, 404 for a map or unit that is not yours.
 */
export type StartUnitOutcome = { kind: "ready" } | { kind: "building" } | { kind: "error"; message: string };

const NETWORK = "We could not reach OryxLearn. Check your connection and try again.";
const FAILED = "This unit could not be built this time. Your progress is saved, so try again.";

export async function startUnit(mapId: string, unitId: string, signal?: AbortSignal): Promise<StartUnitOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/units/${encodeURIComponent(unitId)}`, {
      method: "POST",
      signal,
    });
  } catch {
    if (signal?.aborted) return { kind: "building" };
    return { kind: "error", message: NETWORK };
  }
  const body = (await response.json().catch(() => null)) as { status?: string; error?: string } | null;
  if (response.status === 202 || body?.status === "building") return { kind: "building" };
  if (response.ok && body?.status === "ready") return { kind: "ready" };
  return { kind: "error", message: body?.error ?? FAILED };
}
