# What Mirza's side is working on

Abdu: this file is the live plan for Mirza's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Abdu to Mirza" in TEAM.md.

Last updated: Sat Nov 7, evening.

## Working on now

- **Full-page reading for a skill** (OK'd by Abdu via Mirza): a "Full page" button beside the ✕ in the skill panel. It covers the map area with the lesson, flashcards, quiz and teach-back in a centred reading column, and "Back to map" returns to the side panel. On phones the sheet goes full height. Touches: `src/features/skill-map/ui/SkillPanel.tsx` only. **Please avoid that file until this lands (minutes).**

## Next

- Watching Abdu's pushes in the background, and pulling before every commit.
- Waiting on the owner for the next task. Candidates from the infra review: an overall time budget in `features/ai` so a slow provider can't produce a raw 504 (Abdu's, would ask first); refusing the memory store in production (`src/shared/store`, Abdu's, would ask first).

## Done today (latest first)

- Owner indexes: `listMapsByOwner` and `listProgramsByOwner` read only that owner's documents, and likes are counted from keys (`85d20eb`). Touched `skill-map/storage.ts`, `skill-map/index.ts`, `programs/storage.ts`, with Abdu's OK.
- Review (SM-2), dashboard, network (`/people`), sample flashcard and quiz script, Devpost draft.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
