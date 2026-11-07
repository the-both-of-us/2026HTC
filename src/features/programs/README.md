# programs

**Owner:** Abdu. See `TEAM.md`.

A broad goal, such as a job, a degree or "learn web development", becomes a **program**: 4 to 8 courses in order, each a normal skill map of 6 to 10 topics.

- The landing has a size toggle: **Decide for me**, **Full program**, **One course**. Anything but "One course" posts to `POST /api/programs`.
- `plan.ts` makes one model call. Its rubric decides `isBroad` (a role, degree, field or wide goal is broad; one tool, idea or question is not), and it always plans the courses. `cleanPlan` keeps unique slugs, at most 8 courses, and lets a course require only courses before it, so there are no loops.
- On "Decide for me", a narrow input builds one map, as before. Otherwise the program is saved at `programs/<id>` (`types.ts`). `ownerId` and the source text never leave the server: the page gets a `ProgramView`.
- A course's map is built only when the learner presses **Start course** (`openCourse`). It uses skill-map's `generateCourseMap`, which passes the program title and the other courses so each course stays in its lane. A `claimDoc` on `program-courses/<id>/<slug>` makes sure two clicks make one map; the loser gets 202 and the page asks again. A claim whose map never appeared is retried after 3 minutes.
- A course opens once **half** of each course it requires is proved (`unlock.ts`), so the path keeps moving. The map header shows "Course 2 of 6 · program" and "Prove N more to open the next course" (`ui/ProgramCrumb`).
- To keep a long path from getting dull, the program page (`ui/ProgramScreen`) shows topics proved, a badge per finished course, the nearest unlock as one clear goal, and a cheer when a course opened or a badge was earned since this browser last looked.
- Privacy matches maps: only the owner can open a program. `deleteProgramsByOwner` runs from "Delete my data".

The sample "Junior Backend Developer" posting has a saved plan and first course in `fixtures/` (real model output from `scripts/cache-sample-program.ts`), so the demo needs no AI wait. Its later courses are built live when opened.

Tests: `npm test -- programs`.
