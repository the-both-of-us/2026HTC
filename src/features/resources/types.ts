/** One link to something outside OryxLearn. Every URL comes from a source's API, never from a model. */
export type ResourceKind = "watch" | "read" | "listen" | "news";

export type ResourceItem = {
  id: string;
  kind: ResourceKind;
  title: string;
  /** Who made it: a channel, an author, a podcast or a publisher. */
  by: string;
  url: string;
  thumbnail?: string;
  /** A short plain description, at most about 160 characters. */
  summary?: string;
  /** A YouTube video id, so the client can embed it from youtube-nocookie.com. */
  videoId?: string;
};

export type ResourceList = { items: ResourceItem[] };
