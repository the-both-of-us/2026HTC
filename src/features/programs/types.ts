import type { SourceKind } from "@/shared/types";

/** One course in a program. Its map is built the first time the learner opens it. */
export type ProgramCourse = {
  /** kebab-case, unique within the program */
  slug: string;
  title: string;
  /** One sentence on what the learner can do after it. */
  summary: string;
  /** Slugs of earlier courses that open this one. */
  requires: string[];
  mapId?: string;
};

/** Stored at programs/<id>. ownerId never leaves the server. */
export type Program = {
  id: string;
  ownerId: string;
  title: string;
  summary: string;
  sourceKind: Exclude<SourceKind, "pdf">;
  sourceText: string;
  /** Set when the program came from a sample posting, so the page can say it is sample text. */
  sampleId?: string;
  /** Who the program is pitched at, such as "Grade 1 students (about 6 years old)". Every course inherits it. */
  audience?: string;
  courses: ProgramCourse[];
  createdAt: string;
};

/** "How broad should this be?" from the landing toggle. Auto lets the model decide. */
export type ProgramShape = "auto" | "program" | "course";

export type CourseState = "locked" | "open" | "done";

/** One course as the program page shows it. */
export type CourseView = {
  slug: string;
  number: number;
  title: string;
  summary: string;
  mapId: string | null;
  proven: number;
  /** Topics in the course, or null before it is built. */
  total: number | null;
  state: CourseState;
  /** The course badge: its final interview was passed. Proving every topic opens that interview. */
  badge: boolean;
  /** What stands between a locked course and opening it. */
  blockers: { title: string; needed: number | null }[];
};

/** What a browser gets: no ownerId, no source text. */
export type ProgramView = {
  id: string;
  title: string;
  summary: string;
  sourceKind: Program["sourceKind"];
  isSample: boolean;
  courses: CourseView[];
};
