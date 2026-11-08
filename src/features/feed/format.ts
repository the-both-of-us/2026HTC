/** Which kind of item the feed shows: everything, YouTube Shorts only, or text cards only. */
export const FEED_FORMATS = ["both", "videos", "text"] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];

/** ?format= from a request; anything unknown is "both". */
export function parseFormat(value: string | null | undefined): FeedFormat {
  return (FEED_FORMATS as readonly string[]).includes(value ?? "") ? (value as FeedFormat) : "both";
}

/** True when an item of this kind belongs in the format. */
export function inFormat(kind: "card" | "short", format: FeedFormat): boolean {
  return format === "both" || (format === "videos" ? kind === "short" : kind === "card");
}
