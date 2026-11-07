/** A user's proven skills, used for matching. Demo profiles must say so on screen. */
export type PeerProfile = {
  ownerId: string;
  displayName: string;
  city: string;
  provenSkills: string[];
  isDemoProfile: boolean;
};
