import type { Interest } from "./suggestions";

export type { Interest } from "./suggestions";

/** One idea in an interest's shared pool, stored at feed-pool/<slug>. */
export type PoolCard = {
  /** `<slug>.c<n>`, stable for as long as the card is in the pool. */
  id: string;
  title: string;
  body: string;
  /** A short phrase you could build a course on, for "Go deeper". */
  subtopic: string;
  createdAt: string;
};

/** An educational YouTube Short in an interest's pool, stored at feed-shorts/<slug>. Only what YouTube returned. */
export type PoolShort = {
  /** `<slug>.v<videoId>`. */
  id: string;
  videoId: string;
  title: string;
  channel: string;
  /** What it was searched for, used by "Go deeper". */
  subtopic: string;
  addedAt: string;
};

/** What a browser gets for a text card. */
export type FeedCard = {
  kind: "card";
  id: string;
  interest: Interest;
  title: string;
  body: string;
  subtopic: string;
  liked: boolean;
  saved: boolean;
};

export type FeedShort = {
  kind: "short";
  id: string;
  interest: Interest;
  subtopic: string;
  short: { videoId: string; title: string; channel: string };
};

export type FeedItem = FeedCard | FeedShort;

export type FeedPage = {
  /** True when the viewer has picked no interests yet, so the picker shows. */
  needsInterests: boolean;
  interests: Interest[];
  items: FeedItem[];
  /** False once every card in the viewer's interests is on screen. */
  more: boolean;
  /** Text cards across the viewer's interests. */
  total: number;
};
