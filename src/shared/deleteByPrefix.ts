import { deleteDoc, listKeys } from "@/shared/store";
import { isUuid } from "./ids";

/**
 * Deletes every doc under `<prefix><mapId>/` for these maps, for "Delete my data". Ids that are
 * not UUIDs are ignored, so nothing outside these maps can be reached. Running it twice is
 * harmless. Returns how many docs were removed.
 */
export async function deleteForMapsUnder(prefix: string, mapIds: string[]): Promise<number> {
  const safe = [...new Set(mapIds)].filter(isUuid);
  const keys = (await Promise.all(safe.map((id) => listKeys(`${prefix}${id}/`)))).flat();
  await Promise.all(keys.map((key) => deleteDoc(key)));
  return keys.length;
}
