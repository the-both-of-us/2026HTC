# settings

**Owner:** Abdu. See `TEAM.md`.

The `/settings` page and the **model router**: which model each AI task gets.

## The page

- **Display:** theme and text size. **Accessibility:** Accessible learning mode. All three are per-browser (localStorage) and live in `src/shared/ui`; they used to sit in the sidebar footer.
- **AI models:** Speed is Auto (recommended), Fast or Thorough. "Advanced" picks a model per task (Auto, gpt-oss-120b or Claude Sonnet). Saved on change with `PUT /api/settings` to `settings/<userId>`, because the routes that call a model read it server-side. `GET /api/settings` gives the defaults to a visitor with no cookie and makes none. "Delete my data" removes the document.

## The router (`router.ts`, pure, table in `router.test.ts`)

Two models only, decided by the benchmark at `/settings/models` (`features/benchmarks`): tier 1 = gpt-oss-120b chain (85.9%, 0.37 s median), tier 3 = Claude Sonnet (95.3%, 2.1 s). Haiku (87.5%, 2.1 s) and Opus (96.9%, 3.3 s, about 3x Sonnet's price) are never picked; `features/ai` can still call them.

Auto, per task: **map** outline and **lesson** = Sonnet when the map's `rating` has difficulty 3 or stakes 3, else gpt-oss-120b; **flashcards, quiz, checks, other** = gpt-oss-120b. `withSubjectFloor` sets stakes to 3 for psychology, health and medicine, law and quantum courses, where gpt-oss-120b fell behind. Unrated maps count as 2 and 2.
Fast = gpt-oss-120b everywhere. Thorough = Sonnet for every task but other. An override wins over the speed for its task.

The map outline has no rating yet, so `guessRating` (keywords, young audience = 1/1) decides its model; the map's own rating comes back with the reply.

```ts
import { tierFor } from "@/features/settings";
const tier = await tierFor("lesson", viewerId, ratingOf(map)); // one store read; Auto on any error. ratingOf guesses for maps built before ratings.
await chatJSON({ ..., tier });
```

Lessons, flashcards and quizzes are saved and shared, so the settings of whoever opens a skill first decide its model.

Tests: `npm test -- settings`.
