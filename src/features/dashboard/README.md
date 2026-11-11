# dashboard

**Owner:** Mirza. See `TEAM.md`.

`/dashboard`: your maps, what you have proven, what is due for review, and your day streak.

**Status:** built.

## How it renders

`DashboardScreen` is a server component. The page shell renders straight away; the content waits behind `<Suspense>`, calls `connection()`, reads the session with `getSession()` and calls the other features directly. There is no `/api/dashboard`. The only client code is `StreakCard`, because days are counted in the viewer's timezone.

A visitor with no cookie, or with no maps, gets a welcome with links to build a map (`/`) and to browse courses (`/courses`). Signed-in visitors are greeted by their display name. The user id is never sent to the browser.

## Sections

- **Proven skills:** the total, and "Across n of your maps".
- **Review:** cards due today (`dueCount + newCount` from `getReviewSummary`) with **Review now** when above 0, or when the next card is due, or a note that flashcards come back here.
- **Streak:** "Day streak: n" and the last seven days as dots, each with text ("Tuesday: active").
- **Your courses:** one card per course from `listMapsByOwner`, newest first. If you hold a course and a copy of it, only your copy shows (matched on title and skills); the proofs on both still count. A row has: title, subtitle, "2 of 7 skills proven" with a bar (the text carries the number), a Public or Private badge (`isPublished`), "Your copy of a shared course" when `forkedFrom` is set (a course start and a study circle look the same), last activity, **Open map** and, when public, **Course page**. A trash button on the cover (`ui/DeleteCourseButton.tsx`, a sibling of the card's link) opens a confirm panel over the card; "Delete for good" calls `DELETE /api/maps/[id]` (same as the course page) and refreshes. Courses inside a program have no button (`canDelete`), because they go with the program.
- **Recently proven:** the 8 most recent proofs (skill, map, when), each linking to its map.

## Data

`data.ts`: `loadDashboard(userId)` reads the maps, then for each map `listProvedNodes` and `isPublished`, and `getReviewSummary` and `listReviewActivity` alongside. `assembleDashboard` is the pure part. Proofs only count for skills still on the map, once each. A map's last activity is its latest proof, or when it was made.

The maps are required: if they can't be read the page says so. Review, proofs and publish state each fall back (null, none, private) and log `[dashboard]`, so one failed read never blanks the page.

Times such as "3 hours ago" are elapsed time (`format.ts`), so the server can render them for any timezone.

## Streak

`streak.ts`, tested with fixed offsets so it passes in any timezone. The server sends the timestamps of proofs (`provenAt`) and reviews (`listReviewActivity`) from the last 60 days. The browser turns each into its local day (`-getTimezoneOffset()` at that moment, so clock changes are right) and counts back:

- Today counts if it has activity.
- If today has none yet but yesterday does, the streak still shows, with "Keep it going today."
- Otherwise it is 0.

`StreakCard` renders "Counting your days." on the server and while hydrating (`useSyncExternalStore`), so the server and browser never disagree.

## Files

`data.ts`, `streak.ts`, `format.ts`, `ui/DashboardScreen.tsx`, `ui/StreakCard.tsx`, with tests beside them.

**Look:** a hero band (greeting, one line on where things stand, "Continue <latest course>" or "Browse courses", and "Build a map"), three stat tiles that show zeros on a first visit, your courses as `CourseCard`s with progress, recently proven skills, and up to 3 popular public courses you have not started ("Start with a course", or "More to explore"). `CourseRow.startedFrom` is what leaves started courses out.

**Pre-test passes:** `ProvenItem.pretest: true` marks a recent proof that is a course pre-test pass; show it as "Known: passed a pre-test question".
