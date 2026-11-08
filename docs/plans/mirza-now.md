# What Mirza's side is working on

Abdu: this file is the live plan for Mirza's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Abdu to Mirza" in TEAM.md.

Last updated: Sat Nov 7, late night.

## Working on now

- **Shorts inside each skill** (owner's request): a "Watch in 60 seconds" row of 3 or 4 relevant portrait Shorts at the end of the Read tab. One shared list per skill at `skill-reels/<topicKey>` (a hash of map title, skill id, skill title and audience), so a course and every learner's copy share one document and one YouTube search, made when the skill is first opened, never at map build. Shorts are checked to be portrait and 60 s or less (`videos.list`, 1 unit). New feature `src/features/reels` and `src/app/api/reels` (mine). Small edits in Abdu's code: the feed's Short player moves to a shared `src/shared/ui` component used by both, and one line in `lessons/ui/LessonTab.tsx` (or wherever the Read tab lives) for the row. Abdu: shout if you're in those files.

## Next

- Watching Abdu's pushes in the background, and pulling before every commit.
- Waiting on the owner for the next task. Candidates from the infra review: an overall time budget in `features/ai` so a slow provider can't produce a raw 504 (Abdu's, would ask first); refusing the memory store in production (`src/shared/store`, Abdu's, would ask first).

## Done today (latest first)

- Feed Shorts redesign (`c6a19c4`): no frame, header or badge; the video edge to edge at 9:16 with the rail beside it and one caption row (title, interest, channel link, Go deeper). YouTube's controls are off: tap to pause or play, and a sound button that stays on for later Shorts; the card loops each Short itself. Touched Abdu's `features/feed/ui/FeedScreen.tsx` and the feed README (see TEAM.md).
- Submission docs: removed "Read the Grid" and AESO from the Devpost text, video script and AI disclosure, after `d62c14e`. StatCan numbers stay (still on the landing page).
- Map header inside a study circle: the "In circle" row and "Start a study circle" are gone; a small "Your circle" button (to `/circle/<code>`) takes the latter's place, for the creator and every member. Circle buttons are now `sm` like the rest of the header, and the topic tag is one short "AI-made, no citations" with the full sentence as a tooltip. Touched Abdu's `app/map/[id]/page.tsx`, `circles/ui/{CircleBanner,StartCircleButton}.tsx`, `circles/client.ts`, `skill-map/ui/MapScreen.tsx`.
- Full-page skill reading is bigger and wider: the column is 1024px (was 768), the lesson fills it at 20px text (was 17px, capped at 65ch), the title is 32px and the section headings 24px; flashcards and quiz grow to match. Only in full page (`data-reading-page` on the panel plus Tailwind `lg:in-data-[reading-page]:`); the side panel is unchanged. Touched Abdu's `SkillPanel.tsx` and `LessonTab.tsx`, and my flashcards and quiz tabs.
- People page cleanup: compact cards (initials, name and city in one header, "Looking for" on one line, slim reason line, smaller wrapping skill chips with "+N more"), masonry columns so short cards don't stretch, one summary row with a search box (name, skill or city) and the demo note, lighter side panel, one "Practise ... on your map" link per mentor card. Touched `features/network/ui/**` only.
- People: clickable skills. A skill on any card filters to the people who proved it, with "Practise <skill>" and "Show everyone"; mentor cards get "Practise on your map" links. New `GET /api/network/practise` redirects to the skill on your own map or to `/courses?q=`; `/courses` now reads `?q=`. Touched `features/network/**`, `app/api/network/practise`, `features/courses/ui/CoursesScreen.tsx`.
- Course page redesign: a progress card ("3 of 14 skills proven" plus your main action), a compact Public/Private bar for owners, and skills as clickable cards with Ready/Locked/Proven. A skill opens in your map as a full page via `/map/<id>?skill=<nodeId>`; for a learner who hasn't started, it starts the course first. Small additions in Abdu's `MapScreen.tsx` and `SkillPanel.tsx` (see TEAM.md).
- Sidebar "Sign out" now lines up with "Signed in as" (`-ml-3` became `-ml-0.5` in `src/shared/ui/Account.tsx`, Abdu's file, at the owner's request).
- Locked skills: no lesson, flashcards or quiz is generated for a locked skill (UI hides them; lessons, flashcards and quiz return 403 before any model call). The owner can press "Unlock anyway": saved at `unlocks/<mapId>/<ownerId>/<nodeId>`, the skill becomes available everywhere including proving, and shows "Unlocked early". New `POST /api/maps/[id]/unlock`, `unlockNode` and `isNodeLockedFor` in teachback, `unlockedEarlyIds` in skill-map; `MapProgress.unlocked` in shared types. The sample script passes `ignoreLock`.
- Full-page reading for a skill: a "Full page" button beside the ✕ in the skill panel. On large screens it covers the map area with a centred reading column; on phones it's a full-screen sheet above the top bar. "Back to map" returns. Touched `skill-map/ui/SkillPanel.tsx` only, with Abdu's OK.
- Owner indexes: `listMapsByOwner` and `listProgramsByOwner` read only that owner's documents, and likes are counted from keys (`85d20eb`). Touched `skill-map/storage.ts`, `skill-map/index.ts`, `programs/storage.ts`, with Abdu's OK.
- Review (SM-2), dashboard, network (`/people`), sample flashcard and quiz script, Devpost draft.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
