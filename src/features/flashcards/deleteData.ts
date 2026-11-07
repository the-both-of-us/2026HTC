import { deleteDoc, listKeys } from "@/shared/store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deletes the saved cards for these maps (`flashcards/<mapId>/<nodeId>`), for "Delete my data".
 * Pass the user's own map ids, before the maps themselves are deleted. Ids that are not
 * UUIDs are ignored, so nothing outside these maps can be reached. Running it twice is
 * harmless. Returns how many skills' cards were removed.
 */
export async function deleteForMaps(mapIds: string[]): Promise<number> {
  const safe = [...new Set(mapIds)].filter((id) => UUID_PATTERN.test(id));
  const keys = (await Promise.all(safe.map((id) => listKeys(`flashcards/${id}/`)))).flat();
  await Promise.all(keys.map((key) => deleteDoc(key)));
  return keys.length;
}
