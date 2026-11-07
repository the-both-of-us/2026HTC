/** Types only this feature uses. The old PublicCourse in shared/types.ts is not used. */

/** What `courses/<mapId>` holds. Present means the course is public. */
export type CourseListing = {
  mapId: string;
  title: string;
  subtitle: string;
  /** The owner's id, which is their identity cookie. Server only: never sent to a browser. */
  authorId: string;
  authorName: string;
  skillCount: number;
  /**
   * The like total when the course was last published. The live total is in
   * `likes/<mapId>/_count`, and readers swap it in (see withLikeCount in listing.ts).
   */
  likeCount: number;
  /**
   * True when the course is built from a sample posting, which is fictional: the seeded
   * courses, and any learner's course made from one.
   */
  isSample: boolean;
  publishedAt: string;
  updatedAt: string;
};

/** The only course shape that ever leaves the server. */
export type PublicCourse = Omit<CourseListing, "authorId">;

/** One skill in a course preview. */
export type CourseSkill = {
  id: string;
  title: string;
  why: string;
  /** True when the job posting asks for it directly. */
  fromSource: boolean;
};

/** What GET /api/courses/[mapId] returns. */
export type CourseDetail = {
  /** The listing, or null while the course is private. */
  course: PublicCourse | null;
  /** The map's own title and subtitle, so a private course can still be shown to its owner. */
  title: string;
  subtitle: string;
  published: boolean;
  /** Built from a sample posting, so the page must say it is not a real job ad. Set while private too. */
  isSample: boolean;
  isOwner: boolean;
  likedByMe: boolean;
  /**
   * The viewer's own copy, if they started this course and the copy still exists, so the
   * page can offer "Continue this course". Always null for the owner. The id is the viewer's own map.
   */
  myCopyId: string | null;
  /** In learning order: every skill comes after the skills it needs. */
  skills: CourseSkill[];
};

export type LikeResult = { liked: boolean; likeCount: number };

export type CourseSort = "popular" | "new";

/** Builds the public shape field by field, so a new server-only field can never slip through. */
export function toPublicCourse(listing: CourseListing): PublicCourse {
  return {
    mapId: listing.mapId,
    title: listing.title,
    subtitle: listing.subtitle,
    authorName: listing.authorName,
    skillCount: listing.skillCount,
    likeCount: listing.likeCount,
    isSample: listing.isSample,
    publishedAt: listing.publishedAt,
    updatedAt: listing.updatedAt,
  };
}
