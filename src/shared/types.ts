/**
 * Shared contract between features. Change it only when a feature truly needs to,
 * and keep it plain data: everything here is stored as JSON.
 */

/** "topic" means the learner only named a subject: there is no source, so its maps have no citations. */
export type SourceKind = "posting" | "pdf" | "topic";

/** Where a skill came from. `verified` is set by code, never by the model. */
export type Citation = {
  kind: SourceKind;
  quote: string;
  /** 1-based PDF page. Absent for postings. */
  page?: number;
  verified: boolean;
};

export type SkillNode = {
  /** kebab-case, unique within a map */
  id: string;
  title: string;
  /** One plain sentence on why this job needs it. */
  why: string;
  /** Node ids that must be proven first. Validated to form a DAG. */
  prerequisites: string[];
  /** True if the source asks for this directly; false if it is a foundation for something it asks for. */
  fromSource: boolean;
  citation: Citation | null;
  /** 3 or 4 specific, checkable facts a real explanation must state. */
  checkpoints: string[];
  /*
   * Syllabus fields. Code copies them from the course's syllabus topic when it builds the node;
   * the model never writes them. All absent on nodes built before syllabi existed, and every
   * reader must then behave exactly as before (skill-map's `skillBlock` prints the old text).
   * None of them is an answer key, so unlike checkpoints they may reach a browser.
   */
  /** The syllabus unit this node belongs to, such as "u1". */
  unitId?: string;
  /** The syllabus topic it was built from. Equal to `id` for nodes built from a syllabus. */
  topicId?: string;
  /** 2 or 3 things the learner can do after this topic. */
  objectives?: string[];
  /** 3 to 6 terms the topic must define. */
  keyTerms?: string[];
  /** One sentence on what this topic covers. */
  inScope?: string;
  /** One sentence on what it leaves to other topics or courses. */
  outOfScope?: string;
};

/**
 * A skill as a browser gets it. Checkpoints are the answer key, so readers get how many
 * there are and never their text. Learners see them only in their own graded attempts.
 */
export type PublicSkillNode = Omit<SkillNode, "checkpoints"> & { checkpointCount: number };

export type SkillMap = {
  id: string;
  ownerId: string;
  title: string;
  /** Role, employer and place, when the source states them. */
  subtitle: string;
  sourceKind: SourceKind;
  /** Source text, kept so citations can be re-checked and shown. */
  sourceText: string;
  nodes: SkillNode[];
  createdAt: string;
  /** Set on a copy: the id of the map it was started from. */
  forkedFrom?: string;
  /** Set when this map is one course of a program, so its header can link back. */
  program?: ProgramLink;
  /**
   * Wave 2: the canonical catalog course this learner map studies (`catalog/courses/<courseId>`).
   * Set on every topic map; absent on posting and PDF maps. Shared content (unit nodes, lessons,
   * quiz, flashcards, catch rounds, resources) is keyed by `contentIdOf(map)` = `courseId ?? id`,
   * never by the map id. A map with a courseId stores no `syllabus`: it is attached on read.
   * A canonical id is never a map id, so deletes by map id never touch canonical content.
   */
  courseId?: string;
  /**
   * Who the map is pitched at, such as "Grade 1 students (about 6 years old)". Absent or empty
   * means a general or adult learner. Lessons, teach-back, flashcards and quiz should pitch at it.
   */
  audience?: string;
  /**
   * The plan this course map is built from, unit by unit. Set when unit 1 is built (or adopted
   * from the source map of a copy). It travels with the map, so circle copies and forks get it
   * free. Absent on older maps: they are one flat graph, exactly as before.
   */
  syllabus?: CourseSyllabus;
};

/*
 * Syllabus. It lives here, not in features/syllabus, because the shared contract (`SkillMap`)
 * holds it and shared code never imports a feature. `@/features/syllabus` re-exports these.
 */

/** Quick is today's 4 to 8 course program with one unit per course. Degree is 4 years of 40 courses. */
export type ProgramDepth = "quick" | "degree";

/** Our own planning label for how advanced a course is. Not a university's course number. */
export type CourseLevel = 100 | 200 | 300 | 400;

/** What the learner can do after the course. Ids are "o1", "o2" and so on. */
export type SyllabusOutcome = { id: string; text: string };

/** One planned topic. It becomes one SkillNode whose id equals this id. */
export type SyllabusTopic = {
  /** kebab-case, unique within the course. Becomes the node id, so it never changes once built. */
  id: string;
  title: string;
  /** 2 or 3. */
  objectives: string[];
  /** 3 to 6. */
  keyTerms: string[];
  /** One sentence. */
  inScope: string;
  /** One sentence. */
  outOfScope: string;
  /**
   * Earlier topics this one builds on, instead of repeating them. Each is a topic id earlier in
   * this syllabus, or "<courseSlug>:<topicId>" for a topic in an earlier course's syllabus.
   * Validated to point backwards only.
   */
  buildsOn: string[];
};

export type SyllabusUnit = {
  /** "u1", "u2" and so on, in order. */
  id: string;
  title: string;
  /** The course outcomes this unit serves. Every outcome is served by at least one unit. */
  outcomeIds: string[];
  /** True once this unit's nodes are in the map. */
  built: boolean;
  topics: SyllabusTopic[];
};

export type CourseSyllabus = {
  version: 1;
  /**
   * The map whose unit cache (`unit-nodes/<rootMapId>/<unitId>`) every copy shares, so a circle
   * copy building unit k gets the same nodes and ids at zero model calls. Set when unit 1 is
   * built. Absent on a draft that has no map yet.
   */
  rootMapId?: string;
  /**
   * Wave 2: true while the canonical syllabus is still being written. It is set only on a
   * syllabus attached on read from the partial doc (`partial/catalog/syllabi/<courseId>`), so
   * `units` holds just the units committed so far (possibly none) and more will follow. Never
   * stored on a final syllabus. Absent means final.
   */
  planning?: boolean;
  depth: ProgramDepth;
  courseSlug: string;
  level?: CourseLevel;
  /** 4 to 6. */
  outcomes: SyllabusOutcome[];
  /** Quick: 1 unit of 6 to 10 topics. Degree: 8 units of 4 to 6 topics. See SYLLABUS_SHAPE. */
  units: SyllabusUnit[];
  assessment: {
    /** A 4-question unit test after each unit (degree only). */
    unitTests: boolean;
    /** Questions in the course final: 3 for quick (as today), 6 for degree. */
    finalQuestions: number;
  };
};

/**
 * Every count the syllabus, units, lessons and tests are built to. Code checks these; prompts
 * quote them. Quick's numbers equal today's, so a quick course reads exactly like before.
 */
export const SYLLABUS_SHAPE = {
  quick: {
    units: 1,
    topicsPerUnit: { min: 6, max: 10 },
    unitTests: false,
    finalQuestions: 3,
    finalPassMark: 2,
    lessonWords: { min: 600, max: 900 },
    practiceCases: 0,
  },
  degree: {
    units: 8,
    topicsPerUnit: { min: 4, max: 6 },
    unitTests: true,
    finalQuestions: 6,
    finalPassMark: 4,
    lessonWords: { min: 1000, max: 1400 },
    practiceCases: 2,
  },
} as const satisfies Record<
  ProgramDepth,
  {
    units: number;
    topicsPerUnit: { min: number; max: number };
    unitTests: boolean;
    finalQuestions: number;
    finalPassMark: number;
    lessonWords: { min: number; max: number };
    practiceCases: number;
  }
>;

/** Per syllabus, whatever the depth. */
export const SYLLABUS_LIMITS = {
  outcomes: { min: 4, max: 6 },
  objectivesPerTopic: { min: 2, max: 3 },
  keyTermsPerTopic: { min: 3, max: 6 },
} as const;

/** The unit test after each degree unit. Stored as a final attempt with node id `unitTestNodeId(unitId)`. */
export const UNIT_TEST = { questions: 4, passMark: 3 } as const;

/** Node id of a unit's test, such as "final:u2". The course final keeps its own id ("final-interview"). */
export function unitTestNodeId(unitId: string): string {
  return `final:${unitId}`;
}

/** A degree program: 4 years of 2 terms, 5 courses a term, so 40 courses. */
export const DEGREE_FRAME = { years: 4, termsPerYear: 2, coursesPerTerm: 5, courses: 40 } as const;

/** Reading speed every computed reading time uses (the lessons feature uses the same 200). */
export const READING_WORDS_PER_MINUTE = 200;

/** Where a course map sits in its program. Fixed when the course is built. */
export type ProgramLink = {
  id: string;
  title: string;
  /** 1-based position of this course in the program. */
  courseNumber: number;
  courseCount: number;
  /** Titles of the courses that open once half of this one is proved. */
  unlocks: string[];
};

export type IntegritySignals = {
  pasted: boolean;
  /** Milliseconds of active typing or speaking. */
  activeMs: number;
  wordCount: number;
  inputMethod: "typed" | "voice";
};

export type CheckpointResult = {
  checkpoint: string;
  /** Exact learner words, verified by code. Null when not met. */
  quote: string | null;
  met: boolean;
};

export type Grade = {
  /** Computed by code: max(0, round(met / total * 100) - 20 * errors) */
  score: number;
  checkpoints: CheckpointResult[];
  misconceptions: string[];
  /** Model quotes that failed verification. Kept for the eval harness. */
  rejectedQuotes: number;
};

export type FollowUp = {
  question: string;
  answer: string | null;
  passed: boolean | null;
  feedback: string | null;
  /** How the answer was given, as the browser reported it. Missing on answers saved before Nov 7. */
  inputMethod?: "typed" | "voice";
  /** Milliseconds from the question appearing to the learner starting to answer. Missing when not known. */
  startedAfterMs?: number;
};

export type AttemptStatus = "needs-followup" | "proven" | "not-yet";

/**
 * How a skill was proved. "explain" is the original teach-back, "catch" is finding the AI's
 * planted mistakes, "kid" is explaining to a 10-year-old, "timed" is saying it in 30 seconds.
 * "final" marks a question in a course's final interview, which is not tied to one skill.
 */
export type ProofFormat = "explain" | "catch" | "kid" | "timed" | "final" | "pretest";

/*
 * Pre-test passes (features/pretest). A topic answered correctly in a course's optional pre-test
 * is recorded as proved, like any proof, in `progress/<mapId>/<ownerId>/<topicId>`, but with this
 * id in place of an attempt id and format "pretest". There is no attempt behind it: no
 * explanation, transcript or integrity signals exist, and none may be invented. Everything that
 * shows a proof must label it with PRETEST_PROOF_LABEL, never as an explanation.
 */

/** Stands in for the attempt id of a topic proved by a pre-test question. Never a real attempt id. */
export const PRETEST_PROOF_ID = "pretest";

/** How a pre-test pass is shown everywhere a proof is shown. */
export const PRETEST_PROOF_LABEL = "Known: passed a pre-test question";

/** True when a proof (an attempt id in `MapProgress.proven`) is a pre-test pass, not an attempt. */
export function isPretestProof(attemptId: string | null | undefined): boolean {
  return attemptId === PRETEST_PROOF_ID;
}

/** A finished "Catch the mistake" round, kept on its attempt. Sentence numbers start at 1. */
export type CatchRecord = {
  sentences: string[];
  /** Where the AI planted its mistakes, and what was wrong with each. */
  planted: { sentence: number; why: string }[];
  /**
   * The sentences the learner tapped. fixed is true for a planted mistake they tapped, false for a
   * correct sentence. Since Nov 9 tapping is enough; rounds played before then also kept a
   * written correction, and fixed was the AI's verdict on it.
   */
  picks: { sentence: number; correction?: string; fixed: boolean }[];
};

export type Attempt = {
  id: string;
  mapId: string;
  nodeId: string;
  ownerId: string;
  explanation: string;
  integrity: IntegritySignals;
  grade: Grade;
  followUp: FollowUp | null;
  status: AttemptStatus;
  createdAt: string;
  /**
   * How long the server took, measured around each call, in ms. Grading covers the AI finding
   * quotes plus code checking them and computing the score. Missing on attempts saved before Nov 7.
   */
  timing?: { gradeMs: number; followUpMs: number | null };
  /** Missing on attempts saved before formats existed, which were all "explain". */
  format?: ProofFormat;
  /** Only for "kid": the Flesch-Kincaid reading grade code measured, and whether it was plain enough. */
  plainLanguage?: { readingGrade: number; passed: boolean };
  /** Only for "catch". */
  catch?: CatchRecord;
};

/** Progress for one user on one map. */
export type MapProgress = {
  mapId: string;
  ownerId: string;
  /**
   * nodeId to the id of the attempt that proved it, or PRETEST_PROOF_ID for a pre-test pass. A
   * pre-test pass may name a topic of a syllabus unit not built yet: it becomes the node's state
   * once the unit is built, because node ids equal syllabus topic ids.
   */
  proven: Record<string, string>;
  /** nodeId to when the learner chose "Unlock anyway", skipping its prerequisites. */
  unlocked?: Record<string, string>;
  updatedAt: string;
};

export type NodeState = "locked" | "available" | "proven";

/**
 * Half the checkpoints: 2 of 4, 2 of 3 or 1 of 2. The owner found 65 too strict for a simple
 * topic (Nov 9), so the bar is "you clearly know the core of it", not "you said almost everything".
 */
export const PASS_SCORE = 50;

