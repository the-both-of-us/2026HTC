# pretest

Server code from `@/features/pretest`; client code (`PretestScreen`, `PretestOffer`, `usePretest`) from `@/features/pretest/client`.

An optional, skippable placement pre-test for a **topic course** (a map with a `courseId` and a syllabus), so a learner does not repeat what they know. Never offered on posting or PDF maps (`offer: "none"`, and every POST is a 400).

## The test

- **Multiple choice only.** One question per syllabus topic, each with 4 options and a separate "I don't know this", asked **unit by unit**. Questions come from the syllabus (objectives, key terms, scope), so units whose nodes are not built yet are covered too. Topics already proved are not asked; for a built unit only topics with a node are asked.
- The learner picks one option per question and submits the unit in one request: `POST /answers` `{unitId, answers: [{topicId, choice: 0..3 | null}]}`. `null`, or a question left out, is "I don't know this": it is `skipped` and never passes. A right option is `known`, any other `missed`. A guess is right one time in four, so the unit tests and the final test (which are longer and stricter) still decide.
- The learner can stop at any time (`/stop`, or `stop: true` with a unit's answers). A unit where nothing was right ends the test (`unit-missed`): later units build on it. After the last unit it ends `completed`.
- Once per course per learner (`pretest/<courseId>/<ownerId>`); no retake. A record made on a map the learner has since deleted counts for nothing. A unit is graded once: sending it again is a 409.

## Generation and grading

- **Questions** are canonical per course: `pretest-sets/<courseId>/<unitId>` = `{questions: [{topicId, question, options, explanation}]}` with the **correct option first**, written once under `startOnce` (one `chatJSON`, label `pretest-questions`, write profile, 6k tokens / 40 s) from the canonical syllabus unit, never from learner data. The reply schema applies the shared checks (`mcQuestionProblem`: 4 distinct options, no catch-alls, sane lengths, no option referred to by position), so chatJSON's one repair can fix a bad question. Starting or answering writes the current unit and the next one ahead in `after()`, so a learner never waits for the whole course. A set of the old shape (`keyPoints`, written answers) counts as missing: `readQuestionSet` reports it `idle`, `getQuestionSet` returns null, and `ensureQuestionSet` deletes it and writes a new one.
- **Option order** is per learner and fixed: the record holds a server-only `seed` (a record from before it derives one from the course and owner ids), and `layout.ts` shuffles each question from the seed, unit and topic. So a reload shows the same order, two learners get different orders, and no reply says which option was first.
- **Key stays on the server** until the unit is submitted: a question is sent as `{topicId, topicTitle, question, options}` only. After a submit the results carry a `review` (`question`, `options`, `chosen`, `correctIndex`, `explanation`) for the units already graded, and never for the unit being asked now.
- **Grading** (`grade.ts`) is plain code with the shared `gradeMc`: no model call, no prompt, no label. Results with no `review` (records from before multiple choice) still display.

## Proofs

A `known` topic is recorded with teachback's `markPretestProven`: `progress/<mapId>/<ownerId>/<topicId>` with `attemptId: "pretest"` (`PRETEST_PROOF_ID`) and `format: "pretest"`, even for a topic in a unit not built yet (node id = topic id, so the node shows as proved once the unit is built). It counts wherever proofs count (node states, unit rail incl. unbuilt units, unit and course unlocks, progress, dashboard), never replaces a real proof, and a later passing teach-back replaces it. Unit tests and the course final are still required.

Honesty: every place that shows a proof labels it "Known: passed a pre-test question" (`PRETEST_PROOF_LABEL`): `ProgressView.knownByPretest`, `listProvedNodes(...).pretest`, the evidence page's `knownByPretest` section, circle feed items and avatars (`pretest: true`), network `ProvenSkill.pretest` (and "Passed a pre-test question on …" in match reasons), dashboard `ProvenItem.pretest`. No transcript or integrity signal exists for it.

## Routes

`GET /api/pretest/[mapId]`, `POST …/start`, `POST …/answers`, `POST …/stop`, `POST …/dismiss`, all returning `PretestView` (see `types.ts`).

## Data

"Delete my data" removes `pretest/…/<userId>` records (`deletePretestData`) and the proofs (teachback). The canonical `pretest-sets/` stay. `scripts/wipe-courses.ts` deletes both prefixes in the content scope.

## UI

`ui/` is the pre-test in the browser. The map screen (skill-map) owns where it sits: an offer strip when `offer` is "suggest" and nothing is proved ("Take the pre-test" / "Not now"), a header button ("Take the pre-test", "Continue the pre-test", "Pre-test results") for as long as the offer is not "none", and the screen itself in place of the map.

- `usePretest(mapId, enabled, active, refreshKey)`: reads the view, keeps one request in flight, polls GET every 1.5 s only while `active` and the state is "writing" (paused while the tab is hidden), restarts a "stalled" writer twice by itself and then asks the learner.
- `PretestScreen`: intro, unit of questions (a radio group of four options plus a separate "I don't know this" each, real inputs inside labels at least 44 px tall, "Stop here" always visible), a waiting state with a polite live region, per-question results after each unit (your answer, the correct answer, the explanation), and the end screen with the map's own next-step view. Focus moves to each screen's heading.
- Marks: `PretestBadge` (`@/shared/ui`) says "Known (pre-test)" with the full label in the tooltip and for screen readers. Used on map cards (a plain tick, no seal), All Skills, the unit rail counts, the skill panel and teach-back panel (which still offers the explanation, and a pass replaces the pre-test mark), the evidence page section, circle feed and avatars, network chips and the dashboard.
- No answer key is in the page before a unit is submitted: the API sends none, and `pretest-ui.test.tsx` checks the rendered screens.
