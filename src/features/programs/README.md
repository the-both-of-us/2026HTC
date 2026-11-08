# programs

**Owner:** Abdu. See `TEAM.md`.

A broad goal, such as a job, a degree or "learn web development", becomes a **program**: 4 to 8 courses in order, each a normal skill map of 6 to 10 topics.

- The landing has a size toggle: **Decide for me**, **Full program**, **One course**. Anything but "One course" posts to `POST /api/programs`.
- `plan.ts` makes one model call. Its rubric decides `isBroad` (a role, degree, field or wide goal is broad; one tool, idea or question is not), and it always plans the courses. `cleanPlan` keeps unique slugs, at most 8 courses, and lets a course require only courses before it, so there are no loops.
- On "Decide for me", a narrow input builds one map, as before. Otherwise the program is saved at `programs/<id>` (`types.ts`), with an owner index entry at `programs-by-owner/<ownerId>/<id>`, so `listProgramsByOwner` reads only that person's programs. It works like skill-map's map index, with its own one-time catch-up (`indexes/programs-by-owner-v1`). `ownerId` and the source text never leave the server: the page gets a `ProgramView`.
- A course's map is built only when the learner presses **Start course** (`openCourse`). It uses skill-map's `generateCourseMap`, which passes the program title and the other courses so each course stays in its lane. A `claimDoc` on `program-courses/<id>/<slug>` makes sure two clicks make one map; the loser gets 202 and the page asks again. A claim whose map never appeared is retried after 3 minutes.
- A course opens once **half** of each course it requires is proved (`unlock.ts`), so the path keeps moving. The map header shows "Course 2 of 6 · program" and "Prove N more to open the next course" (`ui/ProgramCrumb`).
- To keep a long path from getting dull, the program page (`ui/ProgramScreen`) shows topics proved, a badge per finished course, the nearest unlock as one clear goal, and a cheer when a course opened or a badge was earned since this browser last looked.
- Privacy matches maps: only the owner can open a private program. Anyone else gets the same "not here" as a missing one (404 from the API). `deleteProgramsByOwner` runs from "Delete my data".

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

The sample "Junior Backend Developer" posting has a saved plan and first course in `fixtures/` (real model output from `scripts/cache-sample-program.ts`), so the demo needs no AI wait. Its later courses are built live when opened.

Tests: `npm test -- programs` (includes `sharing.test.ts` and `src/app/api/programs/sharing-routes.test.ts`).
