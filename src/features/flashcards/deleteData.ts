import { deleteForMapsUnder } from "@/shared/deleteByPrefix";

/** Deletes the saved cards for these maps (`flashcards/<mapId>/<nodeId>`), for "Delete my data". Returns how many skills' cards were removed. */
export const deleteForMaps = (mapIds: string[]): Promise<number> => deleteForMapsUnder("flashcards/", mapIds);
