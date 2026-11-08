# What Mirza's side is working on

Abdu: this file is the live plan for Mirza's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Abdu to Mirza" in TEAM.md.

Last updated: Sat Nov 7, evening (locked skills).

## Working on now

- **Locked skills: no study features until unlocked, plus an "Unlock anyway" button** (OK'd by Abdu via Mirza). A locked skill no longer generates its reading, flashcards or quiz (UI and server both refuse). The owner can press "Unlock anyway": it's saved per learner at `unlocks/<mapId>/<ownerId>/<nodeId>`, the skill becomes Available everywhere, including proving, and shows an "Unlocked early" mark. Touches:
  - `src/features/skill-map/states.ts` (an unlocked skill counts as available), `ui/SkillPanel.tsx`, `ui/MapScreen.tsx`, `ui/SkillNodeView.tsx`, `ui/MapCanvas.tsx`, `ui/SkillList.tsx`, `ui/mapApi.ts`
  - `src/features/teachback/attempts.ts` and `index.ts` (save an unlock, `getProgress` includes it, Delete my data removes it)
  - `src/shared/types.ts` (`MapProgress.unlocked`, optional)
  - new `src/app/api/maps/[id]/unlock/route.ts`
  - `src/features/lessons` and `src/app/api/lessons` (refuse a locked skill)
  - Mirza's own: `flashcards` and `quiz` routes (refuse a locked skill)
  **Please avoid these files until this lands.**

## Next

- Watching Abdu's pushes in the background, and pulling before every commit.
- Waiting on the owner for the next task. Candidates from the infra review: an overall time budget in `features/ai` so a slow provider can't produce a raw 504 (Abdu's, would ask first); refusing the memory store in production (`src/shared/store`, Abdu's, would ask first).

## Done today (latest first)

- Full-page reading for a skill: a "Full page" button beside the ✕ in the skill panel. On large screens it covers the map area with a centred reading column; on phones it's a full-screen sheet above the top bar. "Back to map" returns. Touched `skill-map/ui/SkillPanel.tsx` only, with Abdu's OK.
- Owner indexes: `listMapsByOwner` and `listProgramsByOwner` read only that owner's documents, and likes are counted from keys (`85d20eb`). Touched `skill-map/storage.ts`, `skill-map/index.ts`, `programs/storage.ts`, with Abdu's OK.
- Review (SM-2), dashboard, network (`/people`), sample flashcard and quiz script, Devpost draft.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
