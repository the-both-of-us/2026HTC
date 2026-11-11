# resources

The **Resources** tab in the skill panel: links to videos, reading, podcasts and news for one skill. Ported from the old KnowledgeBox `lib/resources`.

- `POST /api/resources { mapId, nodeId }` looks the skill up on the server (the client never sends a title), then `getResources` returns the saved list or builds it. Access is the same as lessons: the owner, or anyone once the map is a published course.
- Sources, each with a 5 second timeout and run in parallel, so one failing drops only itself: YouTube (3, `safeSearch=strict`, embeddable, needs `YOUTUBE_API_KEY`), Wikipedia summary (only a standard page, never a disambiguation), Google Books (2, keyless), Taddy podcasts (`TADDY_API_KEY`, `TADDY_USER_ID`) and GNews (`GNEWS_API_KEY`).
- Query: skill title plus map title. For a young audience (`isYoungAudience`) it adds "for kids" and skips podcasts and news.
- Saved at `resources/<mapId>/<nodeId>/<audience>` for 7 days, because a YouTube search costs 100 of the 10,000 daily quota units. A result missing a source because of an error is not saved. Fetched only when the tab opens, never at map build.
- No model writes a URL: every link comes from a source's API, and only https links are kept.
- Videos play in place from `youtube-nocookie.com`.
