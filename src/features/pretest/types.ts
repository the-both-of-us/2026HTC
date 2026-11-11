/*
 * The course pre-test. Plain data: stored as JSON, and the `Pretest*View` types are what the API
 * sends to a browser. No view type holds an answer key (`keyPoints`), in any reply.
 */

/** What the learner gave for one question, after code classified it. */
export type PretestOutcome =
  /** Answered, and the check found it right: the topic is recorded as proved ("pretest"). */
  | "known"
  /** Answered, and the check found it wrong or too vague. */
  | "missed"
  /** Empty or "I don't know". Never sent to the model, never passes. */
  | "skipped";

/** Why the pre-test ended. */
export type PretestEndReason =
  /** Every unit of the course was asked. */
  | "completed"
  /** The learner stopped. */
  | "stopped"
  /** Every question of a unit was missed or skipped, so later units (which build on it) are not asked. */
  | "unit-missed";

/**
 * - "suggest": first open of a syllabus course (nothing proved, never dismissed): show the offer now;
 * - "available": can still be taken from the map (dismissed before, or something is proved already);
 * - "in-progress": started, not ended;
 * - "taken": ended (once per course per learner; no retake);
 * - "none": not offered (see `reason`).
 */
export type PretestOffer = "suggest" | "available" | "in-progress" | "taken" | "none";

/**
 * - "not-a-course": a posting or PDF map (no catalog course);
 * - "not-ready": the course's syllabus is not there yet (or failed);
 * - "nothing-left": every planned topic is proved already.
 */
export type PretestNoneReason = "not-a-course" | "not-ready" | "nothing-left";

/**
 * - "not-started": no pre-test yet (or dismissed);
 * - "writing": the current unit's questions (or the syllabus unit itself) are being written: poll GET every 1.5 s;
 * - "stalled": nobody is writing them (a writer failed): POST start again to resume;
 * - "answering": `current` holds the questions to answer;
 * - "ended": see `ended`.
 */
export type PretestState = "not-started" | "writing" | "stalled" | "answering" | "ended";

/** One question as a browser sees it. No answer key. */
export type PretestQuestionView = { topicId: string; topicTitle: string; question: string };

/** The unit to answer now. Only topics not proved yet are asked. */
export type PretestUnitView = {
  unitId: string;
  /** 1-based position in the syllabus. */
  number: number;
  title: string;
  questions: PretestQuestionView[];
};

/** One graded question. No model text, no answer key. */
export type PretestResultView = { unitId: string; topicId: string; topicTitle: string; outcome: PretestOutcome };

/** What GET /api/pretest/[mapId] and every POST under it return. */
export type PretestView = {
  mapId: string;
  offer: PretestOffer;
  /** Only when `offer` is "none". */
  reason?: PretestNoneReason;
  state: PretestState;
  /** Set only when `state` is "answering". */
  current: PretestUnitView | null;
  /** The unit being written while `state` is "writing" or "stalled" (null before the syllabus has it). */
  pendingUnitId: string | null;
  /** Units in the syllabus (so far, while it is still being written). */
  unitsTotal: number;
  /** Units graded so far. */
  unitsDone: number;
  /** Every graded question, in the order asked. */
  results: PretestResultView[];
  /** Set once the pre-test ended. `unitId` is the unit that ended it for "unit-missed". */
  ended: { reason: PretestEndReason; at: string; unitId?: string } | null;
  /**
   * Topic ids proved by a pre-test pass on this map, including topics of units not built yet:
   * mark them "Known: passed a pre-test question" on the map and the unit rail.
   */
  knownTopicIds: string[];
  /** The learner chose "Not now" on the offer. */
  dismissed: boolean;
  /** Most characters one answer may have. */
  maxAnswerCharacters: number;
};

/** POST /api/pretest/[mapId]/answers. A question left out counts as skipped. */
export type PretestAnswersRequest = {
  unitId: string;
  answers: { topicId: string; answer?: string | null; dontKnow?: boolean }[];
  /** Grade these, then end the pre-test ("stopped") instead of moving on. */
  stop?: boolean;
};

/* Server only below. */

/** One question with its answer key. Stored canonically; never sent to a browser. */
export type PretestQuestion = { topicId: string; question: string; keyPoints: string[] };

/** `pretest-sets/<courseId>/<unitId>`: the unit's questions, written once for every learner of the course. */
export type PretestQuestionSet = { courseId: string; unitId: string; questions: PretestQuestion[]; createdAt: string };

/** One graded unit on a learner's record. */
export type PretestGradedUnit = {
  unitId: string;
  gradedAt: string;
  results: { topicId: string; outcome: PretestOutcome }[];
};

/** `pretest/<courseId>/<ownerId>`: one learner's pre-test of one course. Removed by "Delete my data". */
export type PretestRecord = {
  version: 1;
  courseId: string;
  ownerId: string;
  /** The learner's map the passes were recorded on. */
  mapId: string;
  state: "dismissed" | "in-progress" | "ended";
  dismissedAt?: string;
  startedAt?: string;
  /** Index in the canonical syllabus's units of the next unit to ask. */
  unitIndex: number;
  graded: PretestGradedUnit[];
  ended?: { reason: PretestEndReason; at: string; unitId?: string };
};
