# What Mirza's side is working on

Abdu: this file is the live plan for Mirza's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Abdu to Mirza" in TEAM.md.

Last updated: Sat Nov 7, evening.

## Working on now

- Course page redesign (`/courses/[id]`): a cleaner header with one action row, a compact owner bar, and skills as clickable cards that open the skill in your map, in full-page reading view (a guest who hasn't started yet starts the course first). Per-skill progress (proven, ready, locked) for the owner or someone who started it. Files: `src/features/courses/**` (mine), plus a small deep link in Abdu's `skill-map/ui/MapScreen.tsx` (read `?skill=<nodeId>` once on load) and `skill-map/ui/SkillPanel.tsx` (an `initialFullPage` prop).

## Next

- Watching Abdu's pushes in the background, and pulling before every commit.
- Waiting on the owner for the next task. Candidates from the infra review: an overall time budget in `features/ai` so a slow provider can't produce a raw 504 (Abdu's, would ask first); refusing the memory store in production (`src/shared/store`, Abdu's, would ask first).

## Done today (latest first)

- Sidebar "Sign out" now lines up with "Signed in as" (`-ml-3` became `-ml-0.5` in `src/shared/ui/Account.tsx`, Abdu's file, at the owner's request).
- Locked skills: no lesson, flashcards or quiz is generated for a locked skill (UI hides them; lessons, flashcards and quiz return 403 before any model call). The owner can press "Unlock anyway": saved at `unlocks/<mapId>/<ownerId>/<nodeId>`, the skill becomes available everywhere including proving, and shows "Unlocked early". New `POST /api/maps/[id]/unlock`, `unlockNode` and `isNodeLockedFor` in teachback, `unlockedEarlyIds` in skill-map; `MapProgress.unlocked` in shared types. The sample script passes `ignoreLock`.
- Full-page reading for a skill: a "Full page" button beside the ✕ in the skill panel. On large screens it covers the map area with a centred reading column; on phones it's a full-screen sheet above the top bar. "Back to map" returns. Touched `skill-map/ui/SkillPanel.tsx` only, with Abdu's OK.
- Owner indexes: `listMapsByOwner` and `listProgramsByOwner` read only that owner's documents, and likes are counted from keys (`85d20eb`). Touched `skill-map/storage.ts`, `skill-map/index.ts`, `programs/storage.ts`, with Abdu's OK.
- Review (SM-2), dashboard, network (`/people`), sample flashcard and quiz script, Devpost draft.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
