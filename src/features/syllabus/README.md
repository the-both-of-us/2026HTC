# syllabus

A catalog course's plan, written once per course (`catalog/syllabi/<courseId>`, by programs' `ensureCourseBuilt`) and shared by every learner of it: 4 to 6 outcomes, then units of 4 to 6 topics, each topic with objectives, key terms, an in-scope and an out-of-scope sentence, and `buildsOn` links to earlier topics instead of repeats.

- `streamSyllabus(ctx, hooks)`: one streamed Haiku call (`profile: "plan"`, label `syllabus`) as JSON Lines: a head line (outcomes), then one line per unit. Each line is checked on its own (`lines.ts`, `SyllabusBuilder`): trims counts, keeps only real `buildsOn` (an earlier topic here, or `slug:topicId` of a required course's final syllabus), drops unknown outcomes and topics whose titles overlap a sibling course's at Jaccard 0.8 or more, rejects a unit with fewer than 4 usable topics. Units are numbered u1, u2.. in the order they commit.
- `onHead` and `onUnit(unit, soFar)` let the caller save each unit as it arrives (programs emits it to `partial/`, so the map page shows the syllabus filling in, and starts unit 1's nodes the moment u1 commits).
- A bad head restarts once (`onRestart`). Missing units get one repair call that lists what is committed, if 30 s are left. Fewer than 6 units at the end is a 422 `HttpError` (`SYLLABUS_FAILED`); an error mid-stream keeps the units already committed.
- `SyllabusContext` (`types.ts`): the course line, its program's frame, the final syllabi of the courses it requires, and sibling topic titles. Built by programs' `syllabusContextFor`.
- `prompt.ts`: `SYLLABUS_LINES_SYSTEM`, `buildSyllabusPrompt`, `buildRepairPrompt`; untrusted text sits inside tags and copies of those tags are stripped.
- The `CourseSyllabus` type lives in `@/shared/types`; counts in `SYLLABUS_SHAPE`.

Tests: `lines.test.ts` (per-line fixes, unit numbering, the repair, the restart and the 422) and `contract.test.ts`.
