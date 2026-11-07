# courses

**Owner:** Mirza. See `TEAM.md`.

Every map is a private course that only its owner can open. Publishing lists it in the public directory at `/courses`, where anyone can search it, open it and like it once. The three sample postings are seeded as courses by "OryxLearn team", so the directory is never empty.

The UI is exported from `@/features/courses/client`: `CoursesScreen` (`/courses`), `CourseScreen` (`/courses/[id]`) and `PublishCourseButton` (the map header). Everything else is server code from `@/features/courses`.

**Status:** built, except the parts waiting on Abdu (below).

## Storage

| Key | Holds |
|---|---|
| `courses/<mapId>` | The listing (`CourseListing`). Present means public. |
| `likes/<mapId>/<userId>` | One like: `{userId, likedAt}`. Writing it twice changes nothing. |
| `likes/<mapId>/_count` | `{likeCount, countedAt}`: the running total. Readers swap it into the listing. |
| `course-seeds/<sampleId>` | `{mapId, seededAt}`: which map is the seeded course for a sample posting. |

A listing holds `authorId`, the owner's identity cookie. It never leaves the server: every response goes through `toPublicCourse`, which copies the public fields one by one. `routes.test.ts` checks every route's body for owner ids.

## API

| Route | Does | Who |
|---|---|---|
| `GET /api/courses?sort=popular\|new&q=` | `{courses}`: the directory. Popular is most likes, then newest. `q` matches title, subtitle or author name. | Anyone |
| `POST /api/courses` `{mapId, authorName?}` | `{course}` (201): publish, or republish | The map's owner |
| `GET /api/courses/[mapId]` | `{course, title, subtitle, published, isSample, isOwner, likedByMe, skills}` | Anyone if public, else only the owner |
| `DELETE /api/courses/[mapId]` | `{ok: true}`: make it private again | The map's owner |
| `PUT` / `DELETE /api/courses/[mapId]/like` | `{liked, likeCount}` | Anyone but the owner, public courses only |

Errors are `{error: "a sentence for people"}` with a 400, 403, 404 or 500. Raw errors only go to the server log, prefixed `[courses]`.

## Rules

- The user id always comes from `getUserId()`, never from the request body.
- Every map id goes through `getSkillMap` (which checks it is a UUID) before a store key is built. `isPublished` checks the UUID shape itself, so it costs a single read.
- A private course is a 404 for everyone but its owner, the same answer as a missing map, so nobody can tell it exists.
- **Publishing:** the name is trimmed, whitespace collapsed, at most 40 characters, and "Anonymous learner" when empty. "OryxLearn team" is refused in any spelling, so a learner's course can't pass for an official one. Republishing keeps `publishedAt`, recounts the likes, and updates the name, title and `updatedAt`.
- **Samples:** a map built from a sample posting (the exact text, as skill-map matches it) is published with `isSample: true`, whoever publishes it, because its job ad is fictional. The course page shows the label while it is private too.
- **Unpublishing** deletes the listing but keeps the like documents, so republishing brings the count back.
- **Liking:** only public courses, and never your own. The total is recounted from `likes/<mapId>/` after every like and unlike, and saved in `likes/<mapId>/_count`. Only publishing, unpublishing and seeding write `courses/<mapId>`.

## The like count race

Each like is its own document, so two people liking at once never lose a like. The total is a cache: each request counts the like documents, then writes the number to `likes/<mapId>/_count`. If two requests overlap, the slower one can write a count that misses the other's like. The next like or unlike recounts and puts it right. For a hackathon directory that is fine; a real database would use an atomic counter.

Likes never write the listing. An earlier version wrote the whole listing back with the new count, so a like that overlapped an unpublish made the course public again, and one that overlapped a republish undid the new name. `likes.race.test.ts` pauses a like at each read and checks neither can happen.

What can still happen: a like that passed the "is it public?" check just before the owner made the course private still saves its like document and total. The course stays private, and the like counts if it is published again, the same as any like kept through an unpublish.

## Seeding

`listCourses` calls `ensureSampleCourses()` first. For each sample posting, it checks `course-seeds/<id>` and that the map still exists, and only otherwise builds the map with `generateSkillMap` (saved fixture output, so **no AI call**) and publishes it as `isSample: true`.

- Concurrent calls share one run. After every sample checks out, the checks are skipped for 60 seconds.
- A sample that fails is logged and skipped, and not tried again for 5 minutes, so the others still list and a broken seed can't run on every request.
- The seed owner is `oryxlearn-sample-courses`. It is deliberately **not** a UUID: identity only accepts a UUID cookie, so no visitor can claim the seeded maps, even though the value is in public code.
- If two servers seed at once, the loser's listing is hidden from the directory, because only the map named by `course-seeds/` counts as the sample. The check keys on the seed owner, so a learner's sample-labelled course is never hidden.
- A sample that fails (often one failed store read) keeps its last known map id while it waits to retry, so its listing stays visible. If a sample's map id is not known at all (a fresh server whose first read failed), duplicates are not hidden for that run: a rare duplicate is better than a missing sample.
- Sample courses are labelled "Sample" everywhere, with a note that they come from sample postings written for this demo, not real job ads.

## Sign-in

There is no sign-in yet. `session.ts` holds the one seam: `requirePublisher(userId)` and `requireLiker(userId)` allow guests today (they only check the id is a UUID). The Auth0 step makes them require a signed-in session. Nothing else changes.

## Waiting on Abdu

- `copySkillMap(mapId, newOwnerId)`: "Start this course". Until then the course page shows **View the map** and says starting is coming soon. The swap is in one place: `StartCourseAction` in `ui/CourseScreen.tsx`.
- `listMapsByOwner(ownerId)`: "My courses" on the dashboard and `GET /api/courses/mine`.
- Private maps: `GET /api/maps/[id]` should answer only the owner unless `isPublished(mapId)`. Until then a private course's page is hidden, but its map is readable by anyone with the link.
- Putting `<PublishCourseButton mapId={id} />` in the map header.

## Files

- `courses.ts`: list, view, publish, unpublish, `isPublished`. `likes.ts`: like and unlike. `seed.ts`: the sample courses.
- `listing.ts`: store reads and writes. `rules.ts`: names, search, sorting and learning order, as plain functions. `session.ts`: the sign-in seam. `http.ts`: request parsing and error responses.
- `ui/api.ts`: fetch helpers that turn every failure into a sentence. `ui/courseView.ts`: labels and the optimistic like, as plain functions.
- `ui/PublishCourseButton.tsx` holds `PublishControls`, which the course page reuses for its "This is your course" panel.

## Tests

`npm test -- courses` runs the feature's tests and `src/app/api/courses/routes.test.ts`. The AI is mocked, and the seeding tests assert it is never called.
