/** One idea from one topic of a map, as stored at feed-cards/<mapId>. */
export type Topiclet = {
  /** `<mapId>.<n>`, stable for a map's saved cards. */
  id: string;
  mapId: string;
  nodeId: string;
  title: string;
  body: string;
};

/** An educational YouTube Short found for a topic. Only ids and names that YouTube returned. */
export type Short = { videoId: string; title: string; channel: string };

/** What a browser gets for a text card. No owner ids, no checkpoints. */
export type FeedCard = {
  kind: "card";
  id: string;
  mapId: string;
  nodeId: string;
  mapTitle: string;
  topicTitle: string;
  title: string;
  body: string;
  /** The viewer already proved this topic. */
  proven: boolean;
  liked: boolean;
  saved: boolean;
};

export type FeedShort = {
  kind: "short";
  id: string;
  mapId: string;
  nodeId: string;
  mapTitle: string;
  topicTitle: string;
  short: Short;
};

export type FeedItem = FeedCard | FeedShort;

export type FeedPage = {
  items: FeedItem[];
  /** Pass back as ?cursor= for the next page. Null once the viewer has seen every card. */
  nextCursor: string | null;
  /** Text cards in the whole feed, for "3 of 40". */
  total: number;
  /** True when the viewer has no maps yet, so the feed shows the sample courses. */
  fromSamples: boolean;
};
