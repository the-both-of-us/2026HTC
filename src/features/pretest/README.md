# pretest

**Owner:** Abdu. Server code from `@/features/pretest`; client code (`PretestScreen`, `PretestOffer`, `usePretest`) from `@/features/pretest/client`.

An optional, skippable placement pre-test for a **topic course** (a map with a `courseId` and a syllabus), so a learner does not repeat what they know. Never offered on posting or PDF maps (`offer: "none"`, and every POST is a 400).

## The test

- One short-answer question per syllabus topic, asked **unit by unit**. Questions come from the syllabus (objectives, key terms, scope), so units whose nodes are not built yet are covered too. Topics already proved are not asked; for a built unit only topics with a node are asked.
- Every question has "I don't know" (`dontKnow: true`). An empty or "I don't know" answer (ticked, or typed like "idk", "not sure") is `skipped`: it never reaches the model and never passes. An answer that only repeats the question is `missed` without a call.
- The learner can stop at any time (`/stop`, or `stop: true` with a unit's answers). A unit where nothing was right ends the test (`unit-missed`): later units build on it. After the last unit it ends `completed`.
- Once per course per learner (`pretest/<courseId>/<ownerId>`); no retake. A record made on a map the learner has since deleted counts for nothing.

## Generation and grading

- **Questions** are canonical per course: `pretest-sets/<courseId>/<unitId>` = `{questions: [{topicId, question, keyPoints}]}`, written once under `startOnce` (one `chatJSON`, label `pretest-questions`, write profile, 6k tokens / 40 s) from the canonical syllabus unit, never from learner data. Starting or answering writes the current unit and the next one ahead in `after()`, so a learner never waits for the whole course. `keyPoints` is the answer key: no reply ever includes it, errors included.
- **Grading**: one `chatJSON` per unit (label `pretest-grade`, check profile, 2k / 15 s) with only the answers code could not decide, numbered, each inside `<learner_answer>` tags. The model returns `{verdicts: [{item, correct}]}`; code decides: `known` only when every verdict for that item is `correct: true`; a missing item is `missed`. No model text reaches the browser. A failed call is a 503 and records nothing.

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
- `PretestScreen`: intro, unit of questions (text box + "I don't know this" each, "Stop here" always visible), a waiting state with a polite live region, per-question results after each unit, and the end screen with the map's own next-step view. Focus moves to each screen's heading.
- Marks: `PretestBadge` (`@/shared/ui`) says "Known (pre-test)" with the full label in the tooltip and for screen readers. Used on map cards (a plain tick, no seal), All Skills, the unit rail counts, the skill panel and teach-back panel (which still offers the explanation, and a pass replaces the pre-test mark), the evidence page section, circle feed and avatars, network chips and the dashboard.
- No answer key is ever in the page: the API sends none, and `pretest-ui.test.tsx` checks the rendered screens.
