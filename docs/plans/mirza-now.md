# What Mirza's side is working on

Abdu: this file is the live plan for Mirza's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Abdu to Mirza" in TEAM.md.

Last updated: Sat Nov 7, evening.

## Working on now

- Sidebar "Sign out" alignment: it hung 12px left of "Signed in as". One class in `src/shared/ui/Account.tsx` (Abdu's file; the owner asked for it). Nothing else touched.

## Next

- Watching Abdu's pushes in the background, and pulling before every commit.
- Waiting on the owner for the next task. Candidates from the infra review: an overall time budget in `features/ai` so a slow provider can't produce a raw 504 (Abdu's, would ask first); refusing the memory store in production (`src/shared/store`, Abdu's, would ask first).

## Done today (latest first)

- Locked skills: no lesson, flashcards or quiz is generated for a locked skill (UI hides them; lessons, flashcards and quiz return 403 before any model call). The owner can press "Unlock anyway": saved at `unlocks/<mapId>/<ownerId>/<nodeId>`, the skill becomes available everywhere including proving, and shows "Unlocked early". New `POST /api/maps/[id]/unlock`, `unlockNode` and `isNodeLockedFor` in teachback, `unlockedEarlyIds` in skill-map; `MapProgress.unlocked` in shared types. The sample script passes `ignoreLock`.
- Full-page reading for a skill: a "Full page" button beside the ✕ in the skill panel. On large screens it covers the map area with a centred reading column; on phones it's a full-screen sheet above the top bar. "Back to map" returns. Touched `skill-map/ui/SkillPanel.tsx` only, with Abdu's OK.
- Owner indexes: `listMapsByOwner` and `listProgramsByOwner` read only that owner's documents, and likes are counted from keys (`85d20eb`). Touched `skill-map/storage.ts`, `skill-map/index.ts`, `programs/storage.ts`, with Abdu's OK.
- Review (SM-2), dashboard, network (`/people`), sample flashcard and quiz script, Devpost draft.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
