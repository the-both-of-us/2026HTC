# courses

`/courses` browses the **shared catalog**: AI-written courses and programs that already exist (see `@/features/catalog`), with a search box. Learners cannot publish their own maps or programs; every map and program is private to its owner.

The UI is exported from `@/features/courses/client`: `CoursesScreen` (`/courses`). There is no server code here.

- `ui/CoursesScreen.tsx`: the search box (a link such as `/courses?q=SQL%20joins` from "Practise this" on People starts with that search; typing searches after a 250 ms pause), a loading line, an error with "Try again", a one-line summary, and "Clear the search" when nothing matches.
- `ui/SharedCatalog.tsx`: `SharedCatalogView` shows "Shared programs" and "Shared courses", each labelled AI-written, and hides a section that is empty. Programs are always full degrees.
- `ui/sharedApi.ts`: `GET /api/catalog?q=` (`{courses, programs}`, finished entries only). **Start** calls `POST /api/catalog/courses/[courseId]/start` (`{id}`, then opens `/map/<id>`) or `POST /api/catalog/programs/[programId]/start` (`{programId}`, then opens `/program/<id>`). These make no model call, reuse the viewer's existing map or program of that entry, and 404 an unknown or unfinished id. Every failure becomes a sentence.

Tests: `ui/sharedCatalog.test.tsx` renders the sections and checks the summary line; `src/app/api/catalog/routes.test.ts` covers the routes.
