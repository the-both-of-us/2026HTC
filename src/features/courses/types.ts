/** A published map. `courses/<mapId>` holding this document is what makes a map public. */
export type CourseListing = {
  mapId: string;
  title: string;
  subtitle: string;
  /** Server only: this is an identity cookie value, so never send it to a browser. */
  authorId: string;
  authorName: string;
  skillCount: number;
  /** A running total. It can be recounted from the like documents. */
  likeCount: number;
  publishedAt: string;
  forkedFrom?: string;
};
