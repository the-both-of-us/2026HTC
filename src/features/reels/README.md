# reels

**Owner:** Mirza. See `TEAM.md`.

**Quick videos** at the end of a skill's Read tab: up to 4 YouTube Shorts about that skill. Tapping one opens it over the page in the same player as the feed (`ShortPlayer` in `src/shared/ui`): tap to pause, a sound button, previous and next, and arrow keys. With no videos the row is not shown at all.

`SkillShorts` is exported from `@/features/reels/client` and passed to `LessonTab` as `afterLesson` by `SkillPanel`. The server code is `getSkillReels` from `@/features/reels`.

## API

`POST /api/reels { mapId, nodeId }` returns `{ reels: [{ videoId, title, channel, seconds }] }`. The skill's title comes from the saved map, never the request. Access is the same as its lesson: the map's owner, or anyone once it is a published course. A private map is a 404 for strangers, and a skill that is still locked is a 403 (the panel never asks for one).

## Storage: one list per skill, shared by every copy

| Key | Holds |
|---|---|
| `skill-reels/<topicKey>` | `{ reels, query, searchedAt }` |
| `skill-reels-claim/<topicKey>/<hour>` | A claim, so each list is searched at most once an hour across servers |

`topicKey` (`key.ts`) is a hash of the map title, the skill id, the skill title and the audience, **not the map id**. Starting a course copies the map with a new id but the same title and skills, so the course and every learner's copy (and copies of copies) share one document and one search. The map title keeps "Trees" in biology apart from "Trees" in data structures; the audience gives a grade 1 map its own search with "for kids".

Each list stores the title, channel and length next to each video id. That is a little repeated data when one video suits two skills, but it is about 150 bytes, never changes, and saves a store read per video every time a skill opens. No video is stored, only its id; the player embeds it from YouTube. Nothing is stored per learner, so "Delete my data" has nothing to remove here.

## How videos are picked (`youtube.ts`)

1. One search (100 of the 10,000 daily quota units): the skill title, then the map title for a topic or PDF map (not for a job posting, whose title is a role such as "Junior backend developer" and finds career clips), "for kids" for a young audience, then "explained #shorts". `safeSearch=strict`, embeddable only, YouTube's "short" length (under 4 minutes), English.
2. Titles that look like entertainment are dropped (`looksEducational` from the feed), and so is any video whose title and description do not mention the skill itself (hashtags don't count). Map words only help the order, so the most clearly relevant come first.
3. One `videos.list` call (1 unit) for the rest: only portrait videos of 90 seconds or less are kept, since YouTube's "short" filter lets through landscape videos up to 4 minutes.

## When it searches

- Only when someone opens the skill's Read tab, never when a map is built (a 14-skill map would cost 1,400 units).
- A list with videos is kept 30 days; an empty one is tried again after 3. Lists also store `version` (`SEARCH_VERSION` in `reels.ts`): raise it when the search or its filters change, and older lists are looked up again on their next open.
- A failed search (quota, network) saves nothing and keeps the old list if there is one. With no `YOUTUBE_API_KEY` (local development), nothing is searched and the row stays hidden.

Tests mock YouTube: `npm test -- reels`.
