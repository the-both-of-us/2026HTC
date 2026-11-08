# feed

**Owner:** Abdu. See `TEAM.md`.

The **For you** feed at `/feed`: full-screen cards ("topiclets") swiped up like reels, one idea per card in 2 to 4 sentences, with an educational YouTube Short after every third card. It is for passive scrolling, so it comes from **interests**, not maps (maps are the active side). Every card and Short has the same rail: like, comment, save and share, with counts beside the heart and the comment icon, plus **Go deeper**, which opens the landing with the card's subtopic filled in (`/?topic=<subtopic>`), so a card becomes a real course you can prove.

Shorts play edge to edge at 9:16 with no frame and without YouTube's controls, in `ShortPlayer` from `@/shared/ui` (`controls=0`, driven through the player API by `postMessage`; the Shorts on a skill use it too): tap the video to pause or play, and the sound button turns sound on for every Short for the rest of the visit. There is no `loop=1`, because it needs `playlist=<id>`, which brings back YouTube's previous and next buttons; the card restarts a Short when it ends. Below the video are the title, the interest, the channel (a link to the Short on YouTube) and Go deeper.

A switch beside For you and Saved picks **Both** (the default), **Videos** or **Text**. It is a radio group, remembered in `localStorage` (`oryx-feed-format`). `GET /api/feed?format=both|videos|text` returns that kind only, and `?exclude=` paging works the same for each (`format.ts`).

`FeedScreen` is exported from `@/features/feed/client`, the server code from `@/features/feed`.

## Interests

A viewer with none gets the picker (`ui/InterestPicker.tsx`): 24 suggestions (`suggestions.ts`) plus a box to type your own. Pick at least 3 (at most 12), then "Start scrolling"; "Edit interests" brings it back. A typed interest is checked by rules (2 to 60 characters, letters, no links, a short blocklist), then one quick Cerebras call (`POST /api/feed/interests/check`), whose verdict is kept for everyone at `feed-topic/<slug>`. `PUT /api/feed/interests` saves the slugs at `feed-interests/<userId>`; only suggestions and checked interests are accepted.

## The pools (the database)

- Cards: `feed-pool/<slug>`, shared by everyone with that interest. A batch is about 8 cards from one `chatJSON` call (label `feed-pool`, Gemini first). Each card has a title, a body and a `subtopic`. The prompt forbids invented statistics, quotes, people and links; `validate.ts` drops bad lengths, links and titles already in the pool.
- Shorts: `feed-shorts/<slug>`. One YouTube search (100 of 10,000 daily units; `safeSearch=strict`, embeddable, short, and a title filter against pranks, memes and the like) keeps up to 5. Topped up only when the pool is 3 days old, or a day old with fewer than 2 that still show.
- Suggested interests start from `fixtures/pools.json` (written by `npm run cache-feed`, paced for the free tiers), so the demo needs no AI call or search.

## How the feed ranks

`rank.ts` holds the scoring as pure functions, with tests.

- Events: the browser reports how long each item was at least 60% on screen (`POST /api/feed/event`, `sendBeacon` with a keepalive fetch fallback). 1 s or more is a view, under 1.5 s a skip, 8 s or more a long look. Likes, saves, shares and "Go deeper" taps count too. Each is one key, `feed-ev/<itemId>/<event>/<userId>`, so a repeat changes nothing and counts need no locks: one `listKeys` per interest, cached for 60 s.
- Engagement = (3 likes + 4 saves + 5 shares + 5 commenters + 6 deeper + prior) / (views + prior weight), minus a smoothed skip rate, plus a smoothed long-look rate.
- New items get a UCB-style boost that fades as more people see them. Items this viewer has seen drop far down unless saved.
- Interests the viewer likes, saves and lingers on (cards and Shorts alike) get more room (weight 0.6 to 2.5). Interests are interleaved by weight, never more than 2 cards in a row from one. Each interest's best Short shows once per page; a Short with 10 or more views, over 70% skipped and no likes, is retired.
- More action: after the response (`after()`), an interest whose pool this viewer has mostly seen, that has fewer than 8 cards, or whose cards have 3 or more likes gets one new batch, at most once an hour (`claimDoc`). The model is told the best-engaged titles ("what people loved") and every title in the pool. Shorts are searched with the subtopic of a best-engaged card.
- Rotation: `rotatePool(items, stats, cap)` keeps a pool at 40 cards (8 Shorts) after each batch. Only items with 8 or more views (10 for Shorts) can go, never one anyone saved: first the duds (mostly skipped, no likes), then the lowest engagement.

- Videos: every interest's Shorts, ranked the same way and interleaved by interest weight, 6 a page. After the response, an interest the viewer has nearly run out of (fewer than 2 unseen) gets one search if its last one is 6 hours old (one claim per interest per hour, so at most 100 units each).

## Likes and saves

`POST /api/feed/like` and `/save` with `{ cardId, on }` (a card or Short id) write `feed-<reaction>/<userId>/<itemId>` (for the Saved tab, `?view=saved`, which lists saved Shorts too) and the matching engagement event.

**Demo like counts.** At the owner's request the shown count is real likes plus `demoLikeSeed(itemId)`, a stable 3 to 20 from a hash of the id (`demo.ts`). It is display only: ranking and every growth trigger read real counts. Remove it by setting `DEMO_LIKE_SEED` to `null`.

## Comments

Public, plain text, newest first, at most 50 read (`comments.ts`, `GET|POST|DELETE /api/feed/comments`). One key per comment, `feed-comments/<itemId>/<ms>-<hex>`, so posts never race; `feed-comment-by/<userId>/...` indexes the author's own. The name is the signed-in display name, else "Guest" plus 4 hex from a hash of the viewer id; the user id never leaves the server.

Before saving: the rules in `commentRules.ts` (280 characters, no links, emails, phone numbers or "add me on", a blocklist), then 5 a minute per viewer (`claimDoc` slots), then one Cerebras check with a 4 s timeout. If the check fails, the rules alone decide. Each refusal is a specific sentence. Viewers delete their own comments; a comment is an engagement event (weighted like a share). The counts are real only.

`deleteFeedData(userId)` removes the viewer's interests, likes, saves, comments and events, for "Delete my data".

Tests mock the AI and YouTube: `npm test -- feed`.
