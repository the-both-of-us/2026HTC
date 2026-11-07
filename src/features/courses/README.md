# courses

**Owner:** Mirza. See `TEAM.md`.

Every map is a private course that only its owner can open. Publishing lists it in the public directory, where people can browse it, like it once each, and start it. Starting copies the map to the learner.

The full design (data shape, store keys, routes, pages) is in `docs/plans/mirza.md` under "Courses".

- Store keys: `courses/<mapId>` (the listing; present means public) and `likes/<mapId>/<userId>` (one per like).
- Publishing and liking need sign-in. Browsing and starting don't.
- `authorId` never leaves the server.

**Status:** skeleton. `CoursesScreen` and `PublishCourseButton` are placeholders.
