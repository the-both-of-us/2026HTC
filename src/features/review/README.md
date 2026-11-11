# review

Spaced repetition for the flashcards on your own maps, with SM-2 written new. `/review` shows one card at a time: the question, "Show answer", then Again, Hard, Good or Easy, each with the wait it would set under it.

`ReviewScreen` is exported from `@/features/review/client`. Everything else is server code from `@/features/review`.

**Status:** built.

## Which cards

Every saved deck on every map you own (`listMapsByOwner`), which includes your copies of courses and study circles. For each skill it calls `getSavedFlashcards(mapId, nodeId, userId)`: a store read only, never a model call. Skills with no cards yet are skipped. A card is known by its `id` from the saved deck (a UUID). A card with no review state is **new** and due now.

## Queue

`GET /api/review` returns `{queue, dueCount, newCount, moreNew, totalCards, nextDueAt}`.

1. Due reviews first (`dueAt <= now`), the longest overdue first. Every due review is included.
2. Then new cards, at most **20 per queue**, newest map first, skills in map order, cards in deck order.

Each item is `{cardId, mapId, nodeId, front, back, mapTitle, skillTitle, isNew, intervals}`. `intervals` is the wait each grade would set, in days (0 means 10 minutes), for the button labels. `moreNew` is how many new cards are left past the cap: they are due now too, and the next queue offers them. `nextDueAt` is the soonest due time still in the future, or null; it does not count new cards, so read `moreNew` first. States for cards that no longer exist (a deleted map) are ignored. Nothing in the response is a user id.

## SM-2, exactly

`sm2.ts`, checked as a table in `sm2.test.ts`. A new card starts with ease 2.5, repetitions 0, interval 0, lapses 0.

| Grade | q | Ease | Interval | Repetitions |
|---|---|---|---|---|
| Again | 0 | ease − 0.2 | 0: due again in **10 minutes** | reset to 0. Lapses + 1 if it was above 0 |
| Hard | 3 | formula (−0.14) | 1 day if repetitions was 0, else max(previous + 1, round(previous × 1.2)) | + 1 |
| Good | 4 | formula (±0) | 1 day, then 6 days, then round(previous × new ease) | + 1 |
| Easy | 5 | formula (+0.1) | max(Good + 1, round(Good × 1.3)), Good counted with Easy's new ease | + 1 |

- The formula is SM-2's: EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)). Ease is rounded to two decimals and never goes below **1.3**.
- "1 day, then 6 days" depends on repetitions before the answer (0, then 1). "Previous" is the last interval, at least 1.
- Hard multiplies by 1.2 instead of the ease, so it never gets the ease's growth. Both Hard and Easy are always at least a day more than the alternative they shadow, so the four buttons always read Again < Hard ≤ Good < Easy.
- No interval is longer than **365 days**.
- `dueAt` is the grading time plus the interval in days (24-hour days), or plus 10 minutes for Again.

Labels: 0 is "10 min", then "1 day", "n days" under 31, "n months" (days ÷ 30, rounded) under 365, and "1 year".

## Grading

`POST /api/review` `{mapId, nodeId, cardId, grade}` (grade is `again`, `hard`, `good` or `easy`) returns `{dueAt, intervalDays}`.

The map must exist and be yours, the skill must be on it, and the card must be in that skill's saved deck. Anything else is the same **404** ("We could not find that flashcard…"), so nobody can probe for other people's maps or cards. Only after that is a store key built from the card's id. A malformed body is a 400. Errors are `{error: "a sentence for people"}`; raw errors go to the server log prefixed `[review]`.

## Storage

| Key | Holds |
|---|---|
| `review/<userId>/<cardId>` | `ReviewCard`: `{cardId, mapId, nodeId, intervalDays, ease, repetitions, lapses, dueAt, lastReviewedAt}` |
| `review/<userId>/log/<YYYY-MM-DD>` | `{count, firstAt, lastAt}`: reviews on that UTC day |

The key says whose a state is, so documents hold no user id. The log keeps days a card was reviewed before its latest review, which `lastReviewedAt` alone would lose. A UTC day touches at most two local days, and its first and last review show which of them had activity, so the dashboard's local-time streak stays exact. Two reviews saved at the same instant can lose one from `count`; the day still counts.

## Server API

- `getReviewQueue(userId)`, `gradeCard(userId, request)`: what the routes call.
- `getReviewSummary(userId)` → `{dueCount, newCount, moreNew, totalCards, nextDueAt}`, for the dashboard.
- `listReviewActivity(userId, since?)` → ISO timestamps, oldest first: every card's `lastReviewedAt` and each day log's `firstAt` and `lastAt`.
- `deleteUserData(userId)` → `{reviewRecords}`: removes everything under `review/<userId>/`. UUIDs only, and it can run twice.

## Screen

- "x cards due · y new" and "Card 3 of 12" for what is left.
- **Keys** are handled on the card region only, never on the document, and never from text boxes. Space or Enter on the focused card shows the answer (a focused button keeps its own Space and Enter). Once the answer shows, 1 to 4 grade, from the card or a grade button.
- The focusable card is named by its own words (map, skill and question, plus the answer once shown), and its keys are its description, so moving focus to the next card reads the next question. Each card is a new element, so focus always moves. The answer is in a live region; a status line says "Good. Back in 6 days." after each grade.
- **Optimistic:** a grade moves to the next card at once. Answers are saved one after another (`ui/saves.ts`); if one fails, the screen goes back to that card with an `ErrorNotice`, and the answers queued behind it are dropped (they were not sent), so no card is saved twice.
- **Saving the last answer:** while any answer is still in flight, Done says "Saving your last answer…", hides the dashboard link and keeps "Check for more cards" pending. So a failed last save always comes back with its card, and a new queue is never read before the last answer lands (which would show the card again and schedule it twice).
- **Done:** "All caught up", with when the next card is due (soonest of the server's `nextDueAt` and the cards just graded), a link to the dashboard and "Check for more cards". Again cards come back after 10 minutes through that button. When `moreNew` is above 0 it says "Set finished" and "10 more new cards are ready now" instead, with "Check for more cards" as the main button.
- **No cards:** explains that cards appear after you make flashcards on a skill, with links to your maps and to courses.

## Waiting on Abdu

- "Delete my data" (`src/features/trust/deleteData.ts`) should call `deleteUserData(userId)` from `@/features/review` to remove `review/<userId>/`.

## Files

`sm2.ts` (the schedule), `queue.ts` (ordering and the new-card cap), `review.ts` (cards, grading, summary, activity), `storage.ts` (keys and the log), `deleteData.ts`, `http.ts`, `errors.ts`, `ui/api.ts` (fetch helpers that turn every failure into a sentence), `ui/session.ts` (keys and labels as plain functions), `ui/saves.ts` (the save queue), `ui/ReviewScreen.tsx`. `testing.ts` holds test helpers.

## Tests

`npm test -- review` runs these and `src/app/api/review/route.test.ts`. The AI is mocked and asserted never to be called.
