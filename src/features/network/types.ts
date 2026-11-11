/** Types for the network. Only PublicProfile, Match, MyProfileView and NetworkView ever reach a browser. */

/** One skill someone proved with a teach-back. Computed from their progress, never typed. */
export type ProvenSkill = {
  title: string;
  /** The title of the map it was proved on. Never the map id. */
  mapTitle: string;
  /** `/proof/<id>` when the owner's live evidence page for that map shows this skill, else null. */
  evidenceUrl: string | null;
  /**
   * Set when the only proof is a pre-test pass, not a teach-back: show it as "Known: passed a
   * pre-test question", never as an explanation. Absent for a teach-back proof.
   */
  pretest?: true;
};

/** What `network/profiles/<userId>` holds. Server only. */
export type ProfileRecord = {
  /** The owner's identity cookie. Never sent to a browser. */
  userId: string;
  /** A random id, the only id a browser ever sees. */
  publicId: string;
  displayName: string;
  city: string;
  lookingFor: string;
  /** An https link, or null. */
  contactUrl: string | null;
  joinedAt: string;
  updatedAt: string;
  isDemo: boolean;
  /**
   * True when this person opted in to the network, so everyone else in it can see them.
   * Absent on profiles made before the setting existed, which counts as opted out (friends
   * only). Demo profiles are always in the network, whatever this says.
   */
  inNetwork?: boolean;
  /** Friends see my courses and progress. Missing means true. */
  shareProgress?: boolean;
  /** People in the network may send me friend requests. Missing means true. */
  allowRequests?: boolean;
  /** Friends may ping me. Missing means true. */
  allowPings?: boolean;
  /**
   * Demo profiles only: their made-up skills, written by the seed (never by a person).
   * Real profiles never have this; their skills are worked out from their progress.
   */
  demo?: DemoSkills;
};

export type DemoSkills = {
  version: number;
  proven: { title: string; mapTitle: string }[];
  learning: string[];
};

/** Someone's skills as matching sees them. */
export type SkillSet = {
  proven: ProvenSkill[];
  /** Titles of skills on their maps they have not proved yet (available or locked). */
  learning: string[];
  hasMaps: boolean;
};

/** Another person's profile, as anyone may see it. */
export type PublicProfile = {
  publicId: string;
  displayName: string;
  city: string;
  lookingFor: string;
  /** Always null on demo profiles. */
  contactUrl: string | null;
  isDemo: boolean;
  provenSkills: ProvenSkill[];
  joinedAt: string;
};

/** Another person, with why they match the viewer. */
export type Match = {
  profile: PublicProfile;
  score: number;
  /** Their proven skills that the viewer is still learning. */
  mentorFor: string[];
  /** Skills both are learning. */
  sharedLearning: string[];
  /** Skills both have proved. */
  sharedProven: string[];
  /** The same, in words: "Proved SQL joins, which you're learning." */
  reasons: string[];
  /** Network cards: the viewer may send a friend request (real, not a friend, allows requests). */
  canRequest?: boolean;
  /** Network cards: the viewer already asked and is waiting. */
  requestSent?: boolean;
  /** Friend cards: the friend allows pings. */
  canPing?: boolean;
  /** Friend cards: what they are studying, or null when they don't share it. */
  courses?: FriendCourse[] | null;
};

/** One course a friend is studying. Never a map id. */
export type FriendCourse = { title: string; proven: number; total: number };

/** The three per-person settings. Missing on a profile means true. */
export type PrivacySettings = { shareProgress: boolean; allowRequests: boolean; allowPings: boolean };

/** A friend request waiting for the viewer. */
export type FriendRequestView = { publicId: string; displayName: string; city: string; since: string };

/** A ping from a friend, until the viewer dismisses it. */
export type PingView = { publicId: string; displayName: string; at: string };

/** The viewer's own profile. */
export type MyProfileView = {
  publicId: string;
  displayName: string;
  city: string;
  lookingFor: string;
  contactUrl: string | null;
  joinedAt: string;
  updatedAt: string;
  /** True when the viewer opted in to the network. False means friends only. */
  inNetwork: boolean;
  provenSkills: ProvenSkill[];
  learning: string[];
} & PrivacySettings;

/** What GET /api/network returns. */
export type NetworkView = {
  me: MyProfileView | null;
  /** The viewer's setting. False (the default) is friends only: mentors, peers and everyone are empty. */
  inNetwork: boolean;
  /** The viewer's friends, whatever their network setting. Never repeated in the sections below. */
  friends: Match[];
  /** People who proved what the viewer is learning, best match first. */
  mentors: Match[];
  /** People learning the same skills, who are not already in mentors. */
  peers: Match[];
  /**
   * Everyone else in the network, not already in mentors or peers. Those who proved a skill
   * the viewer also proved come first, with that reason; then real people, then demo profiles.
   */
  everyone: Match[];
  /** Friend requests waiting for the viewer, newest first. */
  friendRequests: FriendRequestView[];
  /** Pings from friends, newest first. */
  pings: PingView[];
  viewerHasMaps: boolean;
  signedIn: boolean;
  /** True when the viewer must sign in before joining (Auth0 is set up and they are a guest). */
  signInRequired: boolean;
  /** The viewer's own name from sign-in, to pre-fill the form. Never anyone else's. */
  displayName: string | null;
};

/** The profile fields a person types. */
export type ProfileInput = {
  displayName: string;
  city?: string | null;
  lookingFor?: string | null;
  contactUrl?: string | null;
  /** Opt in or out of the network. Left out, an existing profile keeps its setting and a new one is opted out. */
  inNetwork?: boolean | null;
};

/** What GET /api/network/invite/<code> returns: who sent the invite, and what the viewer can do. */
export type InviteView = {
  inviter: { displayName: string; city: string };
  /** The viewer opened their own invite link. */
  isYou: boolean;
  alreadyFriends: boolean;
  /** False when accepting also makes the viewer's profile, so the page asks for a name. */
  hasProfile: boolean;
  signInRequired: boolean;
  /** The viewer's own name from sign-in, to pre-fill the form. */
  displayName: string | null;
};

/** The same fields after cleaning. */
export type CleanProfile = {
  displayName: string;
  city: string;
  lookingFor: string;
  contactUrl: string | null;
};
