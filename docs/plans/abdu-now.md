# What Abdu's side is working on

Mirza: this file is the live plan for Abdu's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Mirza to Abdu" in TEAM.md.

Last updated: Sat Nov 7, evening.

## Working on now

- **AWS redeploy of `1d3694c`** (running; no repo files).
- **Polish pass** (agent). Touches:
  - `features/skill-map/ui` and `features/streaks/ui`: a shorter map header on phones.
  - `features/proof`: a deleted evidence page answers a real 404.
  - `features/lessons`: write the first open topic's lesson right after a map is built, so the Read tab is instant.
  - `features/voice`: dictation keyterms from every topic title on the map, plus common tech terms.
  - `features/teachback`: a full final-interview run, all 3 questions through to the badge.
- **Visual audit, read-only** (agent): every page in Light, Dark and Eye comfort at laptop and phone sizes. It writes findings to `docs/plans/ui-audit.md`; your pages' findings go to you in TEAM.md.
- **UI audit fixes, part 1** (me): readable labels on the /grid mix bar (`features/grid/ui/MixBar.tsx`), and in Dark the landing's sample band becomes a dark raised band instead of a pale slab (`src/app/globals.css`). The audit's map-card items wait for the polish agent.

## Next

- Waiting on the owner: swap the landing's "7.3% Alberta unemployment" seal for something that fits "Learn anything", or keep it. Touches `features/landing`.
- Phone map header wraps tall. Touches `features/skill-map/ui`, `features/streaks/ui`.
- Optional: redeploy AWS from main (needs the owner's `aws login`).

## Done today (latest first)

- Final live check with real AI on production: Explain it, Catch, Age 10, 30 seconds (typed fallback) all pass in 1 to 2 s, and the final interview's first question passes. Fixes in `d1de1c9`. Judge README (`19bc763`).
- Sign in is now a real button: solid at the top of the sidebar footer, outlined in the phone top bar.
- Dark theme softened (`b250273`).
- Sign-in placed in the shell, a `/sign-in` page, and Light, Dark and Eye comfort themes (`b1399b8`).
- Map header in two short rows, map opens at full size (`e3bfe3d`, `dd032aa`).
- Review leftovers: catch answers off the evidence page, lesson fixes, circle states, topic tab first (`a6dd4f7`).
- Seal theme across the app (`61b2706`, `a5c4cfe`).
- Read tab, programs, proving formats, streaks and circles, plus their reviews.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
