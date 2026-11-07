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

## Honesty

- **No answer key to paste.** The lesson teaches every checkpoint but may not copy one: `copiedCheckpoint` rejects the whole checkpoint, or any 8 of its words in a row (the prompt asks for fewer than 6). Otherwise reading would become copy-paste into teach-back.
- **Quotes.** The source text never reaches the model, so a lesson cannot quote the posting or PDF. The only quote a learner sees is the node's citation in "Where this came from", shown only when skill-map verified it word for word.
- **Label.** Every lesson says "Written by AI. Check important facts."

`deleteLessonsForMaps(mapIds)` removes a map's lessons for "Delete my data".

Tests mock the AI: `npm test -- lessons`.
