import { deleteForMapsUnder } from "@/shared/deleteByPrefix";

/** Deletes the saved questions for these maps (`quiz/<mapId>/<nodeId>`), for "Delete my data". Returns how many skills' questions were removed. */
export const deleteForMaps = (mapIds: string[]): Promise<number> => deleteForMapsUnder("quiz/", mapIds);
