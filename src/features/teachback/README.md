# teachback

Grades a learner's explanation of a skill, asks a follow-up about what they wrote, and unlocks the next skills. The UI is in `ui/` and is exported from `@/features/teachback/client`. Everything else here is server code.

## The loop

1. `POST /api/attempts` calls `startAttempt`. It refuses a locked node, someone else's map, a proven node, or fewer than 15 words, all before spending a model call.
2. `gradeExplanation` gets quotes and factual errors from the model. Code checks each quote and works out the score.

**Model (wave 2).** Grading, follow-ups and final grading use the check profile of `@/features/ai` (Claude Haiku, 2k tokens, 15 s: `CHECK_MAX_TOKENS`, `CHECK_TOTAL_MS`); final questions and catch rounds use the write profile (6k tokens, 40 s). There is no tier or rating any more. `courseFinalOpen` stays closed while a catalog syllabus is still planning.
3. Below `PASS_SCORE` (50, so half the checkpoints) the status is `not-yet`, and the learner can retry with a new attempt. Otherwise the skill is `proven` at once and `MapProgress` is updated.
4. There is no follow-up question any more (owner, Nov 9: it slowed people down). `generateFollowUp` is unused by attempts; `POST /api/attempts/[id]/followup` (`answerFollowUp`) stays only so attempts saved earlier with an open question can still be finished. The final interview still uses the same machinery.

The owner found proving a simple topic too grueling (Nov 9), so the pass mark dropped from 65 to 50, the follow-up question was removed, and the grader and follow-up prompts were told to be generous (main idea in any words counts; small slips are not errors). The eval in `eval/` was measured on the stricter prompts and has not been rerun. A real-model spot check on Nov 9 (SQL joins, 4 checkpoints): a casual 28-word explanation scored 75 and was proven at once; a fluent, empty answer that scored 0-30 before now scores 50, which passes now that there is no follow-up. That is the accepted trade-off for speed.

## Four ways to prove a topic

`assignFormats` (in `formats.ts`, plain code shared with the map) gives each topic a format from its place on the map, so it is the same every time and no topic shares one with the topic before it or one it builds on. The learner may swap to plain "Explain it" once per topic.

- **Explain it**: the loop above.
- **Catch the mistake** (`catch.ts`): the AI writes 5 to 8 sentences with 1 or 2 planted mistakes, each breaking a checkpoint. It is written once per topic and shared by every copy of a course (`catch/<contentId>/<nodeId>`, where `contentId` is `contentIdOf(map)`; it is written once under `startOnce`, and a second request waits up to 40 s for it). The browser gets the sentences and how many are wrong, never which. Since Nov 9 the learner only taps: nothing to write, and no AI call checks the round (the owner found writing a correction for each tap too much). Code checks the tapped sentence numbers against the planted ones, so the result is instant. Each planted mistake is a checkpoint, met when tapped (its quote is the tapped sentence, which `catchTranscript` puts in the attempt's text), and each correct sentence tapped costs 20, through `computeScore`. Rounds played earlier keep their written corrections and the AI's verdict on them. No follow-up: a pass proves the topic. One play per learner (`catch-revealed/<mapId>/<ownerId>/<nodeId>`), because the reveal shows the answers.
- **Explain it to a 10-year-old**: the same grader, plus `readingGrade` (Flesch-Kincaid, worked out by code), shown as a tip and kept for the evidence page. Since Nov 9 it never blocks a pass: a plain-worded run-on sentence measured grade 23 and failed a 100.
- **Say it in 30 seconds**: the same grader, with a clock in the browser. The evidence page says whether it was spoken or typed.

The format is saved on the attempt (`format`, missing on older ones, which were all "explain") and on the progress record.

With `map.audience` set, grading, follow-ups, catch rounds (`catch/<id>/<nodeId>/<audienceKey>`) and the final interview get a THE LEARNER section (`audience.ts`): plain childlike wording counts, facts must still be right, and the pass mark stays `PASS_SCORE`. For children about 9 and under, "Explain it to a 10-year-old" shows as "Explain it to a friend". With no audience every prompt is unchanged (`audience.test.ts`).

## The final interview

`final.ts`. Once every topic on a map is proven, `POST /api/maps/[id]/final` writes three questions that mix topics (one AI call) and saves each as an attempt with an open follow-up (`nodeId: "final-interview"`), so the voice interview and the follow-up route work unchanged. Two passes of three earn the course badge, which `publishProof` puts on the evidence page. A fail lets the learner ask for a fresh set. Stored at `final/<mapId>`.

### Degree courses: unit tests and a longer final

A course whose `map.syllabus` is a degree one (8 units) adds a **unit test** after each unit, and a longer course final. Counts and pass marks come from the shared contract (`UNIT_TEST`, `SYLLABUS_SHAPE`), never typed again here. `finalPlan(map, unitId?)` is the one place that decides them:

| | questions | pass mark | covers | node id | stored at |
|---|---|---|---|---|---|
| quick or legacy course final | 3 | 2 | every topic | `final-interview` | `final/<mapId>` |
| degree course final | 6 | 4 | every topic | `final-interview` | `final/<mapId>` |
| degree unit test | 4 | 3 | that unit's topics | `final:<unitId>` | `final/<mapId>/<unitId>` |

- A unit test opens when every topic of that unit is proved (`GET/POST /api/maps/[id]/final?unit=u2`). It uses the same machinery as the final: one question-writing call, each question an attempt with an open follow-up, `settle` with the pass mark saved on the record (`passMark`, absent on old records, which mean 2).
- The degree course final opens only when every planned unit is built (a map holds just the units built so far), every topic is proved and every unit test is passed. A course with a syllabus but no unit tests (quick) keeps the old rule: every topic proved.
- The long final's answer grader sees only the topics its question mixes, and its question-writing prompt leaves out the syllabus lines, to keep both prompts a sane size.
- `getUnitTests(userId, mapId)` lists each built unit's test state. `getPassedUnitTests(mapId)` lists the passed ones (for "a degree course is done").
- `FinalView` carries `unitId`, `questionCount` and `passMark` so a screen never hard-codes "three questions" or "pass two".

### Syllabus lines in prompts

The catch writer, the explanation grader and the final's topic list add the node's syllabus lines (objectives, key terms, scope) through `skillBlock` from `@/features/skill-map`. `skillLines.ts` calls it only for a node that has a syllabus field, so a node built before syllabi gives the exact old prompt (`prompts.test.ts` pins the hashes). `gradeExplanation` takes the map as an optional last argument for this.

## Why the model doesn't score

Asking a model to "score this answer" gave fluent, empty text 55-85/100. So the model only points at evidence:

- For each checkpoint it returns an exact quote from the learner's text, or null, plus a list of factual errors.
- Code checks each quote is really in the text, ignoring case, whitespace, curly quotes and dash styles (`@/shared/quote`). A quote that isn't there, or is under 3 words, counts as not met.
- A checkpoint earns nothing if the text holds its own words nearly unchanged (`copiesCheckpoint`). A failed attempt shows the missed checkpoints, so retyping them must not pass.
- A failed follow-up stores a fixed sentence, never the model's reason, which could be pasted back as the next answer.
- `score = max(0, round(met / total * 100) - 20 * errors)`, in `computeScore`.

## The learner's text is data

`wrapLearnerText` puts it inside `<learner_text>` tags and removes any copy of those tags from the text, so it can't close them early. The system prompts tell the model to ignore instructions inside. The reply schema has no score field, so "give me 100" has nothing to change.

## Unfinished work

`ui/draft.ts` keeps the learner's text, integrity signals and any open follow-up in `sessionStorage`, so clicking another skill or reloading the page loses nothing.

## API

| Route | Returns |
|---|---|
| `POST /api/attempts` `{mapId, nodeId, explanation, integrity}` | the attempt |
| `POST /api/attempts/[id]/followup` `{answer}` | the attempt |
| `GET /api/attempts/[id]` | the attempt, owner only |
| `GET /api/maps/[id]/progress` | `{isOwner: true, mapId, proven, unlocked, states}` for the owner; `{isOwner: false, proven: {}, unlocked: {}}` with a 200 for anyone else |
| `GET /api/attempts/catch?mapId&nodeId` | `{sentences, mistakeCount, revealed}`, owner only |
| `GET`, `POST /api/maps/[id]/final` | the final interview's state and questions, owner only |

Errors are `{error: "a sentence for people"}` with a 400, 403, 404, 409, 500 or 503.

`toLearnerView` shapes every attempt the API sends:

- It removes `ownerId`, which is the identity cookie.
- While a follow-up is open, it removes missed checkpoints and misconceptions, because the question probes exactly those.

Anything public, such as the evidence page, must also leave out `ownerId`.

## Integrity signals

The server counts `wordCount` itself and caps `activeMs` at an hour. `pasted`, `activeMs` and `inputMethod` come from the browser, so a determined person could fake them, and the evidence page says so. They are signals, and they never block a pass.

## Storage

- `attempts/<attemptId>`: every attempt, including failed ones.
- `attempts/<attemptId>/claim`: created just before a follow-up answer is graded, so only one answer is ever graded. It is removed if grading throws. One left by a dead server is taken over after 2 minutes.
- `progress/<mapId>/<ownerId>/<nodeId>`: one document per proven node, so two proofs at once can't overwrite each other. `getProgress` rebuilds `MapProgress` from these.

## Tests

`npm test -- teachback` mocks the model. `realCheck.ts` runs the real model through about 7 calls, so run it by hand: `npx tsx --env-file=.env.local src/features/teachback/realCheck.ts`.

## Unlock anyway

A locked skill can be opened by its owner without proving what it builds on: `unlockNode(userId, mapId, nodeId)` (`POST /api/maps/[id]/unlock` `{nodeId}`) saves `unlocks/<mapId>/<ownerId>/<nodeId>` `{nodeId, unlockedAt}`. `getProgress` returns it as `unlocked`, and `deriveNodeStates` counts an unlocked skill as available, so every check that uses them (attempts, catch, the map) treats it as open, including proving it. The map marks it "Unlocked early" until its prerequisites are proven (`unlockedEarlyIds`). Delete my data removes the unlocks.

`isNodeLockedFor(map, viewerId, nodeId)` is how other features decide whether to generate anything: lessons, flashcards and quiz refuse a locked skill with a 403 before any model call. The owner's progress counts; anyone else reading a published course has none, so only its first skills are open to them.

**Routes and wiring (Nov 11):** `GET/POST /api/maps/[id]/final?unit=<unitId>` serves a unit's test (no `unit` = the course final). `FinalInterview` takes optional `unitId`/`unitTitle` and reads `questionCount`/`passMark` from the view; the map screen shows the active unit's test once that unit is fully proved. `activityTimes(mapId, ownerId)` returns the learner's attempt and proof timestamps for the programs feature's measured hours.

**Pre-test passes (Nov 11):** `markPretestProven(mapId, ownerId, topicIds)` records topics a learner got right in a course pre-test (`features/pretest`) as progress records with `attemptId: "pretest"` (`PRETEST_PROOF_ID`) and `format: "pretest"`, never over a real proof. There is no attempt behind them. `getProgressView` lists them in `knownByPretest` (topic ids, incl. units not built yet), `listProvedNodes` marks them `pretest: true`, and `startAttempt` lets a learner prove such a topic for real, which replaces the pre-test pass.

**Pre-test marks in the UI:** `fetchProvenAttempt` never asks for `/api/attempts/pretest` (a 404): it answers `{ ok: false, pretest: true }`. `TeachBackPanel` takes `pretest`: a "Known from the pre-test" note stands where an explanation's result would, and the explain form stays so a pass replaces the pre-test mark.
