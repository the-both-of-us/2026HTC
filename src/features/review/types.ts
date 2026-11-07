/** Spaced repetition state for one user and one flashcard. */
export type ReviewCard = {
  cardId: string;
  ownerId: string;
  mapId: string;
  nodeId: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  dueAt: string;
};
