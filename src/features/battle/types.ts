export type BattleRoom = {
  code: string;
  mapId: string;
  nodeId: string;
  questionIds: string[];
  players: { id: string; name: string; score: number; answered: number }[];
  status: "waiting" | "playing" | "finished";
  createdAt: string;
};
