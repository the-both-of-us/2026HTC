# feed

**Owner:** Abdu. See `TEAM.md`.

The **For you** feed at `/feed`: full-screen cards ("topiclets") swiped up like reels, one idea per card in 2 to 4 sentences, with an educational YouTube Short after every third card. Each card has like, save, share and **Prove it**, which opens that topic's teach-back (`/map/<id>?skill=<nodeId>`). Passive scrolling leads to active proof. There are no comments: nothing would moderate them, some learners are 6, and circles already cover the social side.

`FeedScreen` is exported from `@/features/feed/client`, the server code from `@/features/feed`.

## Where cards come from

1. `GET /api/feed?cursor=` calls `getFeedPage(viewerId, { cursor })`. The viewer's own maps (built, started courses, and their copies of circle maps), newest 8.
2. A map's cards are saved at `feed-cards/<mapId>` (plus `/<audienceKey>` for a map pitched at an audience). Sample maps use `fixtures/`, written by `npm run cache-feed`, so the demo feed needs no AI call.
3. A map with no cards gets one `chatJSON` call (label `feed-cards`, Gemini first) for about 10 cards, at most 2 maps per page load; the rest join on a later load. If the AI fails the map is skipped quietly.
4. A viewer with no maps, or none with cards yet, gets the sample courses.

Only the map title and each topic's title and why go to the model, never the checkpoints (the grader's answer key) or the source. `validate.ts` drops a card with an unknown topic, a link, a bad length, or a run of 8 checkpoint words in a row, and asks again if fewer than 4 survive. The prompt forbids invented statistics, quotes and links. `map.audience` adds an AUDIENCE section, with toys-and-fruit examples for young children.

## Order

`rank.ts`: open topics the viewer hasn't proved first, then proved topics that are fading (from `getMapHabits`), then locked ones, then recently proved. Maps take turns so one map never fills a screen. A page is 9 cards plus up to 3 Shorts.

## Shorts

`shorts.ts` searches the YouTube Data API (`YOUTUBE_API_KEY`) with `"<topic> <course> explained #shorts"`, `videoDuration=short`, `safeSearch=strict`, `videoEmbeddable=true`, `relevanceLanguage=en`, and drops titles like prank, meme, reaction or ASMR (and songs, unless the audience is young children). A search costs 100 of 10,000 daily units, so each topic is searched only for the cards on the page being served, and the answer is saved at `feed-shorts/<mapId>/<nodeId>` for 5 days (a "none found" for 1 day). If the key is missing or the API fails, the feed is text only and stops searching for 30 minutes. The player is `youtube-nocookie.com`, mounted only while the card is on screen, muted autoplay; with reduced motion it waits for a tap.

## Likes and saves

`POST /api/feed/like` and `/api/feed/save` with `{ cardId, on }`, one document per viewer and card at `feed-like/<userId>/<cardId>`, so a repeat is harmless. Saved cards are listed under the Saved tab (`?view=saved`). `deleteFeedData(userId)` removes them, for "Delete my data". A like does not add a streak spark: sparks count proofs.

Tests mock the AI and YouTube: `npm test -- feed`.
