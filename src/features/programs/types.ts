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
  /** The public program this one was started from, if any. */
  forkedFrom?: string;
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

/** What `program-listings/<programId>` holds. Present means the program is public. */
export type ProgramListing = {
  programId: string;
  title: string;
  summary: string;
  /** The owner's id, which is their identity cookie. Server only: never sent to a browser. */
  authorId: string;
  authorName: string;
  courseCount: number;
  /** Planned from a sample posting, which is fictional. */
  isSample: boolean;
  publishedAt: string;
  updatedAt: string;
};

/** The only listing shape that ever leaves the server. */
export type PublicProgram = Omit<ProgramListing, "authorId">;

/** Builds the public shape field by field, so a new server-only field can never slip through. */
export function toPublicProgram(listing: ProgramListing): PublicProgram {
  return {
    programId: listing.programId,
    title: listing.title,
    summary: listing.summary,
    authorName: listing.authorName,
    courseCount: listing.courseCount,
    isSample: listing.isSample,
    publishedAt: listing.publishedAt,
    updatedAt: listing.updatedAt,
  };
}

/** One course of a public program, as anyone sees it. No map ids, no progress. */
export type PublicCourseOutline = {
  slug: string;
  number: number;
  title: string;
  summary: string;
  /** Topic titles in learning order once the author built the course, else null (built when started). */
  topics: string[] | null;
};

/** A public program for someone other than its owner. */
export type PublicProgramView = {
  id: string;
  title: string;
  summary: string;
  isSample: boolean;
  authorName: string;
  courses: PublicCourseOutline[];
  /** The viewer's own copy, if they started this program and it still exists. */
  myCopyId: string | null;
};

/** The owner's share panel: whether the program is public, and what publishing needs. */
export type ProgramSharing = {
  listing: PublicProgram | null;
  /** A guest while sign-in is set up: show a sign-in sentence instead of the share form. */
  signInRequired: boolean;
  /** The viewer's own name from sign-in, to pre-fill "Name to show". */
  displayName: string | null;
  maxNameLength: number;
};

/** What /program/[id] shows: the owner's own program, or a public one to start. */
export type ProgramPage =
  | { mode: "owner"; program: ProgramView; sharing: ProgramSharing }
  | { mode: "public"; program: PublicProgramView };
