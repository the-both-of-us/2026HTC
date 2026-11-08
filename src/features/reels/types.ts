/** A YouTube Short shown on a skill. Only what YouTube returned: no model writes any of it. */
export type Reel = {
  videoId: string;
  title: string;
  channel: string;
  /** Length in seconds, from YouTube. */
  seconds: number;
};

/** What `POST /api/reels` returns. Empty means there is nothing worth showing, and the row stays hidden. */
export type ReelList = { reels: Reel[] };

/**
 * The saved list for one skill, at `skill-reels/<topicKey>`. One document serves the course and
 * every learner's copy of it. `searchedAt` decides when it is looked up again.
 */
export type SavedReels = { reels: Reel[]; query: string; searchedAt: string };
