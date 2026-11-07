import type { Citation } from "@/shared/types";

export type Flashcard = {
  id: string;
  mapId: string;
  nodeId: string;
  front: string;
  back: string;
  citation: Citation | null;
};
