# programs

A broad goal, such as a job, a degree or "learn web development", becomes a **program**: 4 to 8 courses in order (quick), or a four-year degree of 40 courses, each course a skill map built from its own syllabus (see the end of this file).

- The landing has a size toggle: **Decide for me**, **Full program**, **One course**, and a Quick / Degree depth toggle. A topic posts to `POST /api/programs` (`createProgramOrMap`). A **posting or PDF always makes one private map** (skill-map), never a program and never a catalog entry.
- **Shared catalog** (`@/features/catalog`): a topic program or course is resolved first (alias, exact name, then one check call), so the same subject at the same audience and depth is planned once for everyone. A learner's `Program` (`programs/<id>`) is a thin pointer: `catalogId`, plus per course only `{slug, mapId}`; `getProgram` merges the catalog frame in. `ownerId` and the source text never leave the server.
- **Planning** (`plan.ts`, `build.ts`): `ensureProgramPlanned` streams the frame as JSON Lines under `startOnce(catalog/programs/<id>)`: a head line, then one line per course (quick: 4 to 8 courses; degree: 40 in 4 years x 2 terms, at most 6 a term, levels by year, `requires` only to earlier terms, one repair call for short terms). The `Registrar` registers each course line in the catalog (exact name, then a batch resolve every 10 lines or 3 s), so a course the catalog already has is reused with its syllabus. `GET /api/programs/[id]` shows `planning` while it streams; `POST /api/programs/[id]/plan` restarts a stalled plan.
- **Opening a course** (`openCourse`, `POST /api/programs/[id]/courses/[slug]`) makes **no model call**: it creates the learner's empty map pointing at the catalog course and replies `{status: "ready", mapId}` (202 while another click is opening it, 409 while locked or not registered yet). A `claimDoc` on `program-courses/<id>/<slug>` makes two clicks one map.
- **Building a course** (`ensureCourseBuilt`): the syllabus streams under `startOnce(catalog/syllabi/<courseId>)`, each unit saved as it commits, and unit 1's nodes start (skill-map `ensureUnitNodes`) the moment unit 1 commits. Built once per course for everyone.
- **Pre-generation** (`pregen.ts`, the only file that calls `after()`): rule 1, after a new program: its frame, then course 1's syllabus and unit 1. Rule 2, whenever a course build has unit 1: the canonical lesson of its first topic (`ensureLesson` on the courseId, under the same deadline, no learner map needed); a waiting learner map gets unit 1 appended first. Rule 5, when a course opens: the next course's syllabus and unit 1. Each needs enough of the route's 112 s budget left (70 s for a course, the lesson call's 60 s for a lesson).
- **Unlock** (`unlock.ts`): a degree course opens at `ceil(plannedTopics/4)` of each required course (32 planned topics while its syllabus is still planning), quick and older programs at half. A built course is never locked again.
- To keep a long path from getting dull, the program page shows topics proved, a badge per finished course and the nearest unlock as one goal.
- Privacy matches maps: only the owner can open a private program. Anyone else gets the same 404 as a missing one. "Delete my data" removes the learner's programs and maps (`deleteProgramsByOwner`) and never canonical content (`catalog/`, `unit-nodes/`, `lessons/<courseId>/`).

## Starting a shared catalog entry

`startCatalogCourse(courseId, ownerId)` and `startCatalogProgram(catalogId, ownerId)` (`POST /api/catalog/courses/[courseId]/start`, `.../programs/[programId]/start`) back the "Start" button on /courses. They resolve by exact id (no name resolver, no model call), return the viewer's existing map (a map with that `courseId`) or program (one with that `catalogId`) if there is one, and otherwise create it like `createCourseMap` / `createCatalogProgram` do (the syllabus and unit 1 still build in `after()` if missing). A course needs a final syllabus and a program a final frame, else 404. Concurrent starts by one viewer share one run.

## Sharing (`sharing.ts`)

Mirrors courses, and reuses their rules from `@/features/courses` (author name, sign-in to share once Auth0 is set up, never to unshare or start).

| Key | Holds |
|---|---|
| `program-listings/<programId>` | `ProgramListing`. Present means public. Holds `authorId`, which never leaves the server: responses go through `toPublicProgram`. |
| `program-starts/<programId>/<userId>` | `{copyId, startedAt}`: the learner's copy, so starting again opens it. |

| Route | Does | Who |
|---|---|---|
| `POST /api/programs/[id]/share` `{authorName?}` | `{program}` (201): share or reshare | The owner |
| `DELETE /api/programs/[id]/share` | `{ok: true}`: private again | The owner |
| `POST /api/programs/[id]/start` | `{programId}` of the learner's copy: 201 new, 200 existing; the owner gets their own back | Anyone, if public |
| `GET /api/programs/public?q=` | `{programs}`: newest first, matching title, summary or author | Anyone |

- `/program/[id]` shows the owner their program with a share panel (copyable link once shared), and anyone else a public program's outline (`PublicProgramScreen`: courses in order, topics of courses the author built, "Start this program" or "Continue your program").
- **Starting** makes a new program owned by the learner with the same plan, `forkedFrom` the original. Each course the author already built is copied with `copySkillMap` and re-pointed at the learner's program, so the content is the same; the rest are built on Start course as usual. Double clicks share one run. Unsharing leaves learners' copies alone.
- `/courses` shows a "Programs" shelf above the courses (`PublicPrograms`, same search box), hidden when empty.
- **Delete my data:** `deleteProgramsByOwner` also removes the owner's listings, the starts others left on their programs, and their own starts on others' programs.

- **Catalog programs** are copied as a pointer to the same `catalogId`, with no maps copied: the content is shared anyway. The public outline lists each course's topics from its final syllabus.

Tests: `npm test -- programs` (includes `sharing.test.ts` and `src/app/api/programs/sharing-routes.test.ts`).

## Degree UI (`ui/`, owned by the UI package)

- `ProgramScreen` polls `GET /api/programs/[id]` every 1.5 s while `planning` is set or a course is not `startable`, and offers Try again (`POST .../plan`) when planning is `stalled`.
- `SyllabusScreen` (`/program/[id]/courses/[slug]`) reads `GET .../syllabus`, which has `planning: true` while units are still arriving.
- `ComparePanel` reads `GET /api/programs/[id]/comparison`: our planned, written and measured hours beside sourced norms, always with `NOT_EQUIVALENT`.

## Backend notes

- **Hours** (`hours.ts`, pure): planned = planned topics x lesson words / 200 wpm, written = real lesson word counts of the shared content, measured = attempt and proof gaps under 10 minutes.
- **Comparison** (`views.ts`, `norms.ts`): no model call; every norm carries its URL and read date.
- **Units** (`startUnit`): unit k opens at half of unit k-1 (409 before); restarts a failed syllabus build first.
- **Offline**: `scripts/pregenerate.ts --program <id|topic>` builds a frame, every syllabus, units and (with `--lessons`) lessons through the same `ensure*` calls, so it resumes where it stopped. It refuses a live store without `--live`.

Tests: `build.test.ts` (unit 1 starts while the syllabus streams; overlapping builds generate once), `catalog-flow.test.ts` (the psychology case in both orders and at once, opening with zero calls, planning and stalled views, a failed build restarted, postings kept out of the catalog, Delete my data), `plan.test.ts`, `hours.test.ts`, `storage.test.ts`, and `src/app/api/programs/degree-routes.test.ts`.

**Pre-test passes count:** the unit rail (`unitRail(..., progress.proven)`) counts topics known from the course pre-test in units not built yet, so a course's `proven` (and the next course's unlock) includes them. Unit tests and the final are still required for `complete`.
