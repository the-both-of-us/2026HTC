# lessons

**Owner:** Abdu. See `TEAM.md`.

The **Read** tab: a 3 to 5 minute lesson on one skill, so a learner can learn it before proving it. It is the first tab in the skill panel, before Flashcards and Quiz. `LessonTab` is exported from `@/features/lessons/client`, the server code from `@/features/lessons`.

## A lesson

"The idea" in plain words, a worked example (with code when the skill is technical), "Common mistakes", and "Check yourself": 2 questions whose answers open on tap. The reading time is worked out by code from the word count, at 200 words a minute.

## How it is made

1. `POST /api/lessons { mapId, nodeId }` calls `getOrCreateLesson(mapId, nodeId, viewerId)`. The map's owner may always read; anyone else only once the map is published as a course. A private map gets the same 404 as a missing one, before any store key or model call.
2. A saved lesson at `lessons/<mapId>/<nodeId>` is returned as it is.
3. A map built from a sample posting uses the lessons saved in `fixtures/`, matched by node id and title, so the demo needs no model call. `npx tsx --conditions=react-server scripts/cache-lessons.ts` writes them.
4. Otherwise one `chatJSON` call (label `lesson`, Gemini first via `preferredRoute`, then the normal chain) writes it from the map title and the node's title, why and checkpoints. The source text is never sent.
5. The checks in `validate.ts` run inside the schema, so a reply that fails them gets one retry with the reason. Then it is saved.

**Model.** The router in `features/settings` picks the tier from the map's rating and the settings of whoever opens the skill first (the lesson is then shared). Sonnet and Opus get 50 s per request, and the whole call 100 s inside the route's 120 s, so a slow Claude model can time out and the normal chain still answers.

**Next lesson ahead.** Each `POST /api/lessons` also calls `writeNextLessonSoon(mapId, nodeId, viewerId)`: after the response, it writes the first skill after this one, in the map's order, that is not locked for this viewer. At most one model call, none when it is saved, and never thrown.

**Written ahead.** Every route that builds a map (`/api/maps`, `/api/maps/pdf`, `/api/programs` for one course, and opening a program course) calls `writeFirstLessonSoon(mapId)`. With Next's `after()` it writes the lesson for the first topic with no prerequisites once the response is sent: one model call at most, so the Read tab is instant. Opening the tab mid-write joins the same call.

## Lessons for children

With `map.audience` set, the prompt adds an AUDIENCE section and the length follows the age (`targetWords`): 200 to 350 words up to about 9, 350 to 600 up to 13, the usual 600 to 900 after. A children's lesson also has a ceiling and no code. Its key is `lessons/<mapId>/<nodeId>/<audienceKey>`, so a lesson written for adults before the audience was known is never served.

## Honesty

- **No answer key to paste.** The lesson teaches every checkpoint but may not copy one: `copiedCheckpoint` rejects the whole checkpoint, or any 8 of its words in a row (the prompt asks for fewer than 6). Otherwise reading would become copy-paste into teach-back.
- **Quotes.** The source text never reaches the model, so a lesson cannot quote the posting or PDF. The only quote a learner sees is the node's citation in "Where this came from", shown only when skill-map verified it word for word.
- **Label.** Every lesson says "Written by AI. Check important facts.", and a newly written one names the model and time: "Written by AI (Claude Sonnet, 14 s)". That comes from `writtenBy` (`chatJSON`'s `onServed`), saved with the lesson; sample and older lessons have none.

`deleteLessonsForMaps(mapIds)` removes a map's lessons for "Delete my data".

Tests mock the AI: `npm test -- lessons`.
