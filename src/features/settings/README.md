# settings

**Owner:** Abdu. See `TEAM.md`.

The `/settings` page and the **model router**: which model each AI task gets.

## The page

- **Display:** theme and text size. **Accessibility:** Accessible learning mode. All three are per-browser (localStorage) and live in `src/shared/ui`; they used to sit in the sidebar footer.
- **AI models:** Speed is Auto (recommended), Fast or Thorough. "Advanced" picks a model per task (Auto, gpt-oss-120b, Claude Haiku, Sonnet or Opus). Saved on change with `PUT /api/settings` to `settings/<userId>`, because the routes that call a model read it server-side. `GET /api/settings` gives the defaults to a visitor with no cookie and makes none. "Delete my data" removes the document.

## The router (`router.ts`, pure, table in `router.test.ts`)

Tiers: 1 = gpt-oss-120b chain, 2 = Claude Haiku, 3 = Sonnet, 4 = Opus (see `features/ai`). The base tier comes from the map's `rating` (1 to 3 each; unrated maps count as 2 and 2):

| difficulty \ stakes | 1 | 2 | 3 |
|---|---|---|---|
| 1 | 1 | 1 | 2 |
| 2 | 1 | 1 | 3 |
| 3 | 2 | 3 | 4 |

Auto, per task: **lesson** = base; **map** outline = one step up for a hard course, at most Sonnet (1 stays 1); **flashcards, quiz** = Haiku when base is 3 or more, else 1; **checks** (grading, follow-up questions and grades, catch and final checks) = 1, or Haiku at stakes 3; **other** (feed, program plans, streak relights) = always 1.
Fast = 1 everywhere. Thorough = Auto + 1, at most 4. An override wins over the speed for its task.

The map outline has no rating yet, so `guessRating` (keywords, young audience = 1/1) decides its model; the map's own rating comes back with the reply.

```ts
import { tierFor } from "@/features/settings";
const tier = await tierFor("lesson", viewerId, map.rating); // one store read; Auto on any error
await chatJSON({ ..., tier });
```

Lessons, flashcards and quizzes are saved and shared, so the settings of whoever opens a skill first decide its model.

Tests: `npm test -- settings`.
