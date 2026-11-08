import "server-only";

/** Server code for the Shorts on a skill. Client components are exported from client.ts. */
export { getSkillReels, voteOnReel } from "./reels";
export { deleteReelVotes } from "./votes";
export type { Reel, ReelList, ShownReel, Vote, VoteResult } from "./types";
