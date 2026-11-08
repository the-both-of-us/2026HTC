/** A YouTube Short shown on a skill. Only what YouTube returned: no model writes any of it. */
export type Reel = {
  videoId: string;
  title: string;
  channel: string;
  /** Length in seconds, from YouTube. */
  seconds: number;
};

/** 1 is a like, -1 a dislike, 0 no vote. */
export type Vote = 1 | -1 | 0;

/** A Short as one viewer gets it: with its like count and their own vote. Dislike counts stay on the server. */
export type ShownReel = Reel & { likes: number; myVote: Vote };

/** What `POST /api/reels` returns. Empty means there is nothing worth showing, and the row stays hidden. */
export type ReelList = { reels: ShownReel[] };

/** What `POST /api/reels/vote` returns. `removed` means the video is now gone from the course for everyone. */
export type VoteResult = { likes: number; myVote: Vote; removed: boolean };

/**
 * The saved list for one skill, at `skill-reels/<topicKey>`. One document serves the course and
 * every learner's copy of it. It keeps a few more than are shown, so a removed video's place is
 * taken without a new search. `searchedAt` decides when it is looked up again.
 */
export type SavedReels = { reels: Reel[]; query: string; searchedAt: string; version?: number };
