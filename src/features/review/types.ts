/**
 * Spaced repetition state for one user and one flashcard, stored at review/<userId>/<cardId>.
 * The key says whose it is, so the document holds no user id.
 */
export type ReviewCard = {
  cardId: string;
  mapId: string;
  nodeId: string;
  /** Days until the next review. 0 after "Again", which brings the card back in 10 minutes. */
  intervalDays: number;
  /** SM-2 ease factor: starts at 2.5, never below 1.3. */
  ease: number;
  /** Successful reviews in a row. "Again" resets it to 0. */
  repetitions: number;
  /** Times the card was forgotten ("Again") after at least one successful review. */
  lapses: number;
  dueAt: string;
  lastReviewedAt: string;
};

/** The four answers a learner can give after seeing the back of a card. */
export const GRADES = ["again", "hard", "good", "easy"] as const;
export type Grade = (typeof GRADES)[number];

/** One card in the queue, as the owner's browser gets it. Never a user id. */
export type QueueItem = {
  cardId: string;
  mapId: string;
  nodeId: string;
  front: string;
  back: string;
  mapTitle: string;
  skillTitle: string;
  isNew: boolean;
  /** The schedule each grade would give, so the buttons can say "1 day" or "6 days". */
  intervals: Record<Grade, number>;
};

export type ReviewSummary = {
  /** Cards already reviewed whose time has come. */
  dueCount: number;
  /** New cards offered today: never more than the daily cap. */
  newCount: number;
  /** New cards past the cap. They are due now too, and the next queue offers them. */
  moreNew: number;
  /** Every flashcard on the learner's own maps. */
  totalCards: number;
  /** The soonest due time still in the future, or null if nothing is scheduled. */
  nextDueAt: string | null;
};

export type ReviewQueue = ReviewSummary & { queue: QueueItem[] };

/** What a grade returns: when the card comes back. */
export type ScheduleResult = { dueAt: string; intervalDays: number };
