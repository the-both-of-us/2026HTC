# trust

**Owner:** Abdu. See `TEAM.md`.

The `/trust` page and "Delete my data".

- `ui/TrustScreen`: what we store, what the AI does and what code checks, what an evidence page shows and does not, the grading eval's numbers with their limits (copied from `docs/eval-results.md`, so update them when the eval is rerun), the Accessible learning mode switch, and the delete button.
- `deleteData.ts`: `deleteUserData(userId)`. Evidence pages are withdrawn and removed first (`deleteProofsByOwner`), then course listings (Mirza's `unpublishCourse`), then attempts, answer claims and proven skills (`deleteLearnerData`), then grid answers, then study circles (`deleteCircleData`: memberships, and circles the user started), then maps. It only touches records owned by that user, and it can be run again after a failure.
- `ui/DeleteMyData`: one button, a confirmation in the page (not a browser dialog), then the counts. It also clears this tab's sessionStorage, where unsent drafts live.

**Route:** `DELETE /api/my-data`. It deletes, then replaces the session with a fresh guest. The session is only replaced after deleting worked, so a failed delete can be retried.

**Not covered yet:** flashcards and quiz decks for the user's maps, course likes and course starts. Those are Mirza's records, so `TEAM.md` asks him for a `deleteUserData` export to call here.

Accessible learning mode itself lives in `src/shared/ui` (`learningMode.ts`, `LearningModeToggle`, `ReadAloudButton`), because several features use it.

Tests: `npm test -- trust`. They check another user's map, attempts, progress, evidence page and course are untouched.
