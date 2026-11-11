# lessons

**Owner:** Abdu. See `TEAM.md`.

The **Read** tab: a 3 to 5 minute lesson on one skill, so a learner can learn it before proving it. It is the first tab in the skill panel, before Flashcards and Quiz. `LessonTab` is exported from `@/features/lessons/client`, the server code from `@/features/lessons`.

## A lesson

"The idea" in plain words, a worked example (with code when the skill is technical), "Common mistakes", and "Check yourself": 2 questions whose answers open on tap. The reading time is worked out by code from the word count, at 200 words a minute.

## How it is made

1. `POST /api/lessons { mapId, nodeId }` calls `getOrCreateLesson(mapId, nodeId, viewerId)`. The map's owner may always read; anyone else only once the map is published as a course. A private map gets the same 404 as a missing one, before any store key or model call.
2. A saved lesson at `lessons/<contentId>/<nodeId>/<audienceKey>` is returned as it is. `contentId` is `contentIdOf(map)`: the catalog course id for a catalog map (one lesson per topic, shared by every learner of the course), the map id for a posting or PDF map.
3. A map built from a sample posting uses the lessons saved in `fixtures/`, matched by node id and title, so the demo needs no model call. `npx tsx --conditions=react-server scripts/cache-lessons.ts` writes them.
4. Otherwise it is written once under `startOnce` (`@/shared/store/once`): one `streamLines` call (label `lesson`, write profile: Claude Haiku, 12k tokens, at most 60 s) from the course title, audience, syllabus unit and the node's title, why and checkpoints. The source text and owner are never sent. The reply is JSON lines, one lesson part per line (`lessonLineSchema`); each valid line is cleaned and checked on its own (`cleanLine`, `lineProblem`), and a line that copies a checkpoint or has an empty field is rejected and never shown. If a line was rejected or the assembled lesson fails `lessonProblem`, one rewrite runs (`restart()`, attempt 2) when at least 25 s of the deadline is left; otherwise a 503 sentence. A failure leaves `<key>.failed` for 60 s, so the next request gets one 503 instead of a second call at once.
5. **Section by section.** While a lesson is being written, `getOrCreateLesson` returns `{status: "writing", attempt, parts}` with the parts written so far (`toPublicPart` strips practice `modelAnswer`). The Read tab polls every 1.5 s and swaps in the new parts when `attempt` changes. With `{background}` the route starts the writer after the response; `ensureLesson` returns `ready`, `running` or `no-time` (less than 60 s left).
5. The checks in `validate.ts` run inside the schema, so a reply that fails them gets one retry with the reason. Then it is saved.

**Model.** Every lesson uses the write profile of `@/features/ai`; there is no tier or router any more. The practice check uses the check profile (2k tokens, 15 s).

**Lessons ahead (rule 4).** Each `POST /api/lessons` that serves a lesson also calls `writeUnitLessonsSoon(mapId, nodeId)`: after the response, it starts up to `LESSONS_AHEAD` (2) unwritten lessons later in the same unit, in parallel. A lesson saved or being written is skipped, and it never throws. Because lessons are canonical, one learner's head start serves everyone on the course.

**Written ahead.** Every route that builds a map (`/api/maps`, `/api/maps/pdf`, `/api/programs` for one course, and opening a program course) calls `writeFirstLessonSoon(mapId)`. With Next's `after()` it writes the lesson for the first topic with no prerequisites once the response is sent: one model call at most, so the Read tab is instant. Opening the tab mid-write joins the same call.

## Lessons for children

With `map.audience` set, the prompt adds an AUDIENCE section and the length follows the age (`targetWords`): 200 to 350 words up to about 9, 350 to 600 up to 13, the usual 600 to 900 after. A children's lesson also has a ceiling and no code. Its key is `lessons/<contentId>/<nodeId>/<audienceKey>`, so a lesson written for adults before the audience was known is never served.

## Degree courses

For a map whose `syllabus.depth` is `"degree"` (`isDegree(map)`):

- **Length.** The target is 1,000 to 1,400 words (`DEGREE_TARGET_WORDS`, from `SYLLABUS_SHAPE.degree.lessonWords`), about 5 to 7 minutes. Validation wants 750 to 1,550, so a degree lesson has a ceiling too, as children's lessons do. A child's audience keeps its own shorter length. A quick course's lesson is the usual 600 to 900.
- **Syllabus lines.** A node built from a syllabus gets its objectives, key terms and scope lines from `skillBlock` (`@/features/skill-map`), inside the `<skill>` block. A node with none of those fields gives the old prompt byte for byte (`degree.test.ts` pins the hashes).
- **Practice.** Each degree lesson also has 2 practice cases (`practice: { scenario, question }[]` on the `Lesson`), shown under "Practice". The model writes a `modelAnswer` for each, but it is stored apart, with the lesson's key, as `practiceAnswers` and never put on a `Lesson`, so it cannot reach a browser. `checkPracticeAnswer(mapId, nodeId, viewerId, caseIndex, answer)` compares the learner's answer to it on the server and returns only `{ verdict: "solid" | "partly" | "off", feedback }`; a note that repeats the model answer (an 8-word run) is replaced by a fixed sentence. The browser calls `POST /api/lessons/practice`.

## Honesty

- **No answer key to paste.** The lesson teaches every checkpoint but may not copy one: `copiedCheckpoint` rejects the whole checkpoint, or any 8 of its words in a row (the prompt asks for fewer than 6). Otherwise reading would become copy-paste into teach-back.
- **Quotes.** The source text never reaches the model, so a lesson cannot quote the posting or PDF. The only quote a learner sees is the node's citation in "Where this came from", shown only when skill-map verified it word for word.
- **Label.** Every lesson says "Written by AI. Check important facts.", and a newly written one names the model and time: "Written by AI (Claude Haiku, 14 s)". That comes from `writtenBy` (`modelLabel(modelId())` and the time taken), saved with the lesson; sample and older lessons have none.

`deleteLessonsForMaps(mapIds)` removes a map's lessons for "Delete my data". It takes map ids, so a catalog course's shared lessons are never deleted by one learner.

Tests mock the AI: `npm test -- lessons`.

**For computed hours:** `lessonWordCounts(contentId)` returns the real word count of each written lesson by node id (the longest per node across audiences, model answers excluded). `targetWords` and `wantsPractice` are exported so planned hours use each course's own lesson length. Practice answers are checked at `POST /api/lessons/practice` `{ mapId, nodeId, caseIndex, answer }` and return `{ feedback }`.
