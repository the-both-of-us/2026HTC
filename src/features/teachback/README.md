# teachback

Grades a learner's explanation of a skill, asks a follow-up about what they wrote, and unlocks the next skills. The UI is in `ui/` and is exported from `@/features/teachback/client`. Everything else here is server code.

## The loop

1. `POST /api/attempts` calls `startAttempt`. It refuses a locked node, someone else's map, a proven node, or fewer than 15 words, all before spending a model call.
2. `gradeExplanation` gets quotes and factual errors from the model. Code checks each quote and works out the score.

**Model (wave 2).** Grading and follow-ups use the check profile of `@/features/ai` (Claude Haiku, 2k tokens, 15 s: `CHECK_MAX_TOKENS`, `CHECK_TOTAL_MS`); catch rounds use the write profile (6k tokens, 40 s), and unit and final test questions the write profile (12k tokens, 50 s). Tests are graded by code, never by a model. There is no tier or rating any more. `courseFinalOpen` stays closed while a catalog syllabus is still planning.
3. Below `PASS_SCORE` (50, so half the checkpoints) the status is `not-yet`, and the learner can retry with a new attempt. Otherwise the skill is `proven` at once and `MapProgress` is updated.
4. There is no follow-up question any more (owner, Nov 9: it slowed people down). `generateFollowUp` is unused by attempts; `POST /api/attempts/[id]/followup` (`answerFollowUp`) stays only so attempts saved earlier with an open question can still be finished. It refuses (409) a question of a written final from before Nov 12: that test is retaken as multiple choice.

The owner found proving a simple topic too grueling (Nov 9), so the pass mark dropped from 65 to 50, the follow-up question was removed, and the grader and follow-up prompts were told to be generous (main idea in any words counts; small slips are not errors). The eval in `eval/` was measured on the stricter prompts and has not been rerun. A real-model spot check on Nov 9 (SQL joins, 4 checkpoints): a casual 28-word explanation scored 75 and was proven at once; a fluent, empty answer that scored 0-30 before now scores 50, which passes now that there is no follow-up. That is the accepted trade-off for speed.

## Four ways to prove a topic

`assignFormats` (in `formats.ts`, plain code shared with the map) gives each topic a format from its place on the map, so it is the same every time and no topic shares one with the topic before it or one it builds on. The learner may swap to plain "Explain it" once per topic.

- **Explain it**: the loop above.
- **Catch the mistake** (`catch.ts`): the AI writes 5 to 8 sentences with 1 or 2 planted mistakes, each breaking a checkpoint. It is written once per topic and shared by every copy of a course (`catch/<contentId>/<nodeId>`, where `contentId` is `contentIdOf(map)`; it is written once under `startOnce`, and a second request waits up to 40 s for it). The browser gets the sentences and how many are wrong, never which. Since Nov 9 the learner only taps: nothing to write, and no AI call checks the round (the owner found writing a correction for each tap too much). Code checks the tapped sentence numbers against the planted ones, so the result is instant. Each planted mistake is a checkpoint, met when tapped (its quote is the tapped sentence, which `catchTranscript` puts in the attempt's text), and each correct sentence tapped costs 20, through `computeScore`. Rounds played earlier keep their written corrections and the AI's verdict on them. No follow-up: a pass proves the topic. One play per learner (`catch-revealed/<mapId>/<ownerId>/<nodeId>`), because the reveal shows the answers.
- **Explain it to a 10-year-old**: the same grader, plus `readingGrade` (Flesch-Kincaid, worked out by code), shown as a tip and kept for the evidence page. Since Nov 9 it never blocks a pass: a plain-worded run-on sentence measured grade 23 and failed a 100.
- **Say it in 30 seconds**: the same grader, with a clock in the browser. Answers are typed.

The format is saved on the attempt (`format`, missing on older ones, which were all "explain") and on the progress record.

With `map.audience` set, grading, follow-ups, catch rounds (`catch/<id>/<nodeId>/<audienceKey>`) and the unit and final test writer get a THE LEARNER section (`audience.ts`): plain childlike wording counts, facts must still be right, and the pass mark stays `PASS_SCORE`. For children about 9 and under, "Explain it to a 10-year-old" shows as "Explain it to a friend". With no audience every prompt is unchanged (`audience.test.ts`).

## Unit tests and the final test (multiple choice)

`final.ts`. Since Nov 12 every test is multiple choice (owner: "quizzes and tests should be multiple choice always, no written responses"). Teach-back itself, catch rounds and the optional Practice cases are unchanged.

- **Writing a set:** `POST /api/maps/[id]/final[?unit=<unitId>]` (`startFinalInterview`) makes one write-profile call (`createFinal`) for the whole set: 4 options per question, the correct one first, plus a one or two sentence explanation that never names an option by position (`MC_PROMPT_RULES` from `@/shared/multipleChoice`). Code checks every question (`mcQuestionProblem`: 4 distinct options, no catch-alls, sane lengths; questions must differ), and a reply with too few usable questions gets the AI call's one repair with the problems named; still short, nothing is saved (502). Code shuffles each question's options once and stores them in that order with the key, so a reload shows the same order. Asking again while a set is open, or after passing, returns the same set at no cost; two quick clicks share one call.
- **What the browser gets:** `FinalView` with `questions: {question, options, topics}[]`, built field by field (`toPublic`). No key, no explanation, before submitting, in any reply, error or partial.
- **Submitting:** `POST /api/maps/[id]/final/submit[?unit=<unitId>]` `{testId, answers}` (`submitFinalTest`): one option index per question, the whole test at once. Code grades it (`gradeMc`), no model call. A set is accepted once: the claim `final-submits/<mapId>/<ownerId>/<testId>` makes a second or concurrent submission a 409, and so does a `testId` replaced by a retake. An incomplete submission is a 400 and does not use the set up. The reply, and every later read of that set, carries `review`: each question's choice, correct option and explanation.
- **Retakes:** after a fail, starting again always writes a new set (one model call), never the old one, so answers can't be learned by elimination.
- **Sizes** (a guess is right one time in four, so longer and stricter than the written tests were). `finalPlan(map, unitId?)` is the one place that decides them, from the shared contract (`UNIT_TEST`, `SYLLABUS_SHAPE`):

| | questions | pass mark | covers | stored at |
|---|---|---|---|---|
| final of a map with no syllabus (posting, PDF, legacy) | 5 | 4 | every topic | `final/<mapId>` |
| syllabus course final | 10 | 8 | every topic, grouped by unit in the prompt so every unit gets a question | `final/<mapId>` |
| syllabus unit test | 6 | 5 | that unit's topics (with their syllabus lines) | `final/<mapId>/<unitId>` |

- A unit test opens when every topic of that unit is proved. The syllabus course final opens only when every planned unit is built (a map holds just the units built so far), every topic is proved and every unit test is passed. A map with no syllabus keeps the old rule: every topic proved.
- **Results** are saved on the record (`result: {passed, passedCount, questionCount, format: "multiple-choice", finishedAt}`), where `getPassedUnitTests`, `getPassedFinal` and the unlock and course-completion rules read them. `getUnitTests(userId, mapId)` lists each built unit's test state. Someone else's map is a 404, like a missing one.
- **Labels:** wherever a passed test is shown it says what it was, with its score: `testScoreLabel(result)` gives "5 of 6, multiple choice" (exported from both `index.ts` and `client.ts`). No transcript, typing time or other integrity signal exists for a test, and none is shown. The evidence page shows "Final test: 8 of 10, multiple choice." and each passed unit test.
- **Older records** (written answers, before Nov 12) have `attemptIds` and `topics` instead of `questions` (`WrittenFinalRecord`). A finished one still shows its result as "written answers" (`format: "written"` in the view) and still counts; an unfinished one counts as not started, so the learner takes the multiple-choice test instead. Their attempts stay until "Delete my data".
- `ui/FinalTest.tsx` (`FinalTest` from `client.ts`): locked, ready, the test as one radio group per question (real inputs, 44 px rows), one submit, then the score and a "Review your answers" list. Choices are kept in `sessionStorage` per set, so a reload loses nothing.

### Syllabus lines in prompts

The catch writer, the explanation grader and a unit test's topic list add the node's syllabus lines (objectives, key terms, scope) through `skillBlock` from `@/features/skill-map`. `skillLines.ts` calls it only for a node that has a syllabus field, so a node built before syllabi gives the exact old prompt (`prompts.test.ts` pins the hashes). `gradeExplanation` takes the map as an optional last argument for this.

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
| `GET /api/maps/[id]/progress` | `{mapId, proven, unlocked, states, knownByPretest}` for the owner; a 403 sentence for anyone else |
| `GET /api/attempts/catch?mapId&nodeId` | `{sentences, mistakeCount, revealed}`, owner only |
| `GET`, `POST /api/maps/[id]/final[?unit=]` | the test's state and public questions (no key), or a new set; owner only |
| `POST /api/maps/[id]/final/submit[?unit=]` `{testId, answers}` | the graded test with its review, once per set |

Errors are `{error: "a sentence for people"}` with a 400, 403, 404, 409, 500 or 503.

`toLearnerView` shapes every attempt the API sends:

- It removes `ownerId`, which is the identity cookie.
- While a follow-up is open, it removes missed checkpoints and misconceptions, because the question probes exactly those.

Anything public, such as the evidence page, must also leave out `ownerId`.

## Integrity signals

The server counts `wordCount` itself and caps `activeMs` at an hour. `pasted` and `activeMs` come from the browser, so a determined person could fake them, and the evidence page says so. They are signals, and they never block a pass.

## Storage

- `attempts/<attemptId>`: every attempt, including failed ones.
- `attempts/<attemptId>/claim`: created just before a follow-up answer is graded, so only one answer is ever graded. It is removed if grading throws. One left by a dead server is taken over after 2 minutes.
- `progress/<mapId>/<ownerId>/<nodeId>`: one document per proven node, so two proofs at once can't overwrite each other. `getProgress` rebuilds `MapProgress` from these.

## Tests

`npm test -- teachback` mocks the model. `realCheck.ts` runs the real model through about 7 calls, so run it by hand: `npx tsx --env-file=.env.local src/features/teachback/realCheck.ts`.

## Unlock anyway

A locked skill can be opened by its owner without proving what it builds on: `unlockNode(userId, mapId, nodeId)` (`POST /api/maps/[id]/unlock` `{nodeId}`) saves `unlocks/<mapId>/<ownerId>/<nodeId>` `{nodeId, unlockedAt}`. `getProgress` returns it as `unlocked`, and `deriveNodeStates` counts an unlocked skill as available, so every check that uses them (attempts, catch, the map) treats it as open, including proving it. The map marks it "Unlocked early" until its prerequisites are proven (`unlockedEarlyIds`). Delete my data removes the unlocks.

`isNodeLockedFor(map, viewerId, nodeId)` is how other features decide whether to generate anything: lessons, flashcards and quiz refuse a locked skill with a 403 before any model call. Only the owner reads a map, so only the owner's progress counts.

**Routes and wiring (Nov 11):** `GET/POST /api/maps/[id]/final?unit=<unitId>` serves a unit's test (no `unit` = the course final). `FinalTest` takes optional `unitId`/`unitTitle` and reads `questionCount`/`passMark` from the view; the map screen shows the active unit's test once that unit is fully proved. `activityTimes(mapId, ownerId)` returns the learner's attempt and proof timestamps, plus when each test was started and submitted, for the programs feature's measured hours.

**Pre-test passes (Nov 11):** `markPretestProven(mapId, ownerId, topicIds)` records topics a learner got right in a course pre-test (`features/pretest`) as progress records with `attemptId: "pretest"` (`PRETEST_PROOF_ID`) and `format: "pretest"`, never over a real proof. There is no attempt behind them. `getProgressView` lists them in `knownByPretest` (topic ids, incl. units not built yet), `listProvedNodes` marks them `pretest: true`, and `startAttempt` lets a learner prove such a topic for real, which replaces the pre-test pass.

**Pre-test marks in the UI:** `fetchProvenAttempt` never asks for `/api/attempts/pretest` (a 404): it answers `{ ok: false, pretest: true }`. `TeachBackPanel` takes `pretest`: a "Known from the pre-test" note stands where an explanation's result would, and the explain form stays so a pass replaces the pre-test mark.
