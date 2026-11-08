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

/** What every item carries: this viewer's marks and the counts shown beside the rail buttons. */
type Social = {
  liked: boolean;
  saved: boolean;
  /** Shown like count: real likes plus the demo seed (see demo.ts). Display only. */
  likes: number;
  /** Real public comments, no seed. */
  comments: number;
};

/** What a browser gets for a text card. */
export type FeedCard = Social & {
  kind: "card";
  id: string;
  interest: Interest;
  title: string;
  body: string;
  subtopic: string;
};

export type FeedShort = Social & {
  kind: "short";
  id: string;
  interest: Interest;
  subtopic: string;
  short: { videoId: string; title: string; channel: string };
};

/** A public comment as a browser sees it. Never carries the author's user id. */
export type FeedComment = {
  /** `<13-digit ms>-<8 hex>`, unique within the item. */
  id: string;
  name: string;
  text: string;
  at: string;
  /** True when the viewer wrote it, so they can delete it. */
  mine: boolean;
};

export type FeedItem = FeedCard | FeedShort;

export type FeedPage = {
  /** True when the viewer has picked no interests yet, so the picker shows. */
  needsInterests: boolean;
  interests: Interest[];
  items: FeedItem[];
  /** False once every card in the viewer's interests is on screen. */
  more: boolean;
  /** Items of the requested format across the viewer's interests. */
  total: number;
};

export type { FeedFormat } from "./format";
