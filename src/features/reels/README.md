# reels

**Quick videos** at the end of a skill's Read tab: up to 4 YouTube Shorts about that skill, as rounded portrait cards in a row that scrolls sideways (title, channel and length on each), with **Play all**. Tapping one opens it full screen over a dimmed page in the same player as the feed (`ShortPlayer` in `src/shared/ui`): tap to pause, a sound button, and a rail beside it with like, dislike, previous and next (arrow keys too); the title and channel sit under the video, never on it, so they don't clash with captions. With no videos the row is not shown at all.

`SkillShorts` is exported from `@/features/reels/client` and passed to `LessonTab` as `afterLesson` by `SkillPanel`. The server code is `getSkillReels` from `@/features/reels`.

## API

`POST /api/reels { mapId, nodeId }` returns `{ reels: [{ videoId, title, channel, seconds, likes, myVote }] }`.

`POST /api/reels/vote { mapId, nodeId, videoId, vote: 1 | -1 | 0 }` likes, dislikes or takes the vote back, and returns `{ likes, myVote, removed }`. Same access as the list; guests may vote. Only a video on the skill's saved list can be voted on (else 404). The skill's title comes from the saved map, never the request. Access is the same as its lesson: the map's owner, or anyone once it is a published course. A private map is a 404 for strangers, and a skill that is still locked is a 403 (the panel never asks for one).

## Storage: one list per skill, shared by every copy

| Key | Holds |
|---|---|
| `skill-reels/<topicKey>` | `{ reels, query, searchedAt }` |
| `skill-reels-claim/<topicKey>/<hour>` | A claim, so each list is searched at most once an hour across servers |
| `skill-reel-votes/<topicKey>/<videoId>/<up\|down>/<userId>` | One vote, `{at}`. One key each, so voting twice changes nothing and votes never race; counting is one key listing |

`topicKey` (`key.ts`) is a hash of the map title, the skill id, the skill title and the audience, **not the map id**. Starting a course copies the map with a new id but the same title and skills, so the course and every learner's copy (and copies of copies) share one document and one search. The map title keeps "Trees" in biology apart from "Trees" in data structures; the audience gives a grade 1 map its own search with "for kids".

Each list stores the title, channel and length next to each video id. That is a little repeated data when one video suits two skills, but it is about 150 bytes, never changes, and saves a store read per video every time a skill opens. No video is stored, only its id; the player embeds it from YouTube. The only thing stored per learner is their votes, which "Delete my data" removes (`deleteReelVotes`, called from `trust/deleteData.ts`).

## How videos are picked (`youtube.ts`)

1. One search (100 of the 10,000 daily quota units): the skill title, then the map title for a topic or PDF map (not for a job posting, whose title is a role such as "Junior backend developer" and finds career clips), "for kids" for a young audience, then "explained #shorts". `safeSearch=strict`, embeddable only, YouTube's "short" length (under 4 minutes), English.
2. Titles that look like entertainment are dropped (`looksEducational` from the feed), and so is any video whose title and description do not mention the skill itself (hashtags don't count). Map words only help the order, so the most clearly relevant come first.
3. If the search with the map title keeps fewer than 2 (a long title such as "Bit masks in dynamic programming" can pull a basic skill like "Binary representation basics" toward lectures), a second search on the skill alone adds its results. Only thin results pay for it.
4. One `videos.list` call (1 unit) per search for the rest: only portrait videos of 90 seconds or less are kept, since YouTube's "short" filter lets through landscape videos up to 4 minutes.

## Likes and dislikes (`votes.ts`)

- A list keeps up to 8 videos and shows the first 4 that are still in, so a removed video's place is taken with no new search.
- **Your dislike hides a video from you** once the viewer closes (so a mis-tap can be undone first).
- **Removed for everyone** at 2 or more dislikes that also outnumber the likes (`isRemoved`). One person, or one cleared cookie, cannot remove a video, and a liked video needs more dislikes to go.
- When votes leave fewer than 2 videos, the list is searched again (still at most once an hour), and the search skips every removed video.
- Viewers see the like count and their own vote, never dislike counts or who voted.

## When it searches

- Only when someone opens the skill's Read tab, never when a map is built (a 14-skill map would cost 1,400 units).
- A list with videos is kept 30 days; an empty one is tried again after 3. Lists also store `version` (`SEARCH_VERSION` in `reels.ts`): raise it when the search or its filters change, and older lists are looked up again on their next open.
- A failed search (quota, network) saves nothing and keeps the old list if there is one. With no `YOUTUBE_API_KEY` (local development), nothing is searched and the row stays hidden.

Tests mock YouTube: `npm test -- reels`.
