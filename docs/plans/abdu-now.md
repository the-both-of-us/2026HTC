# What Abdu's side is working on

Mirza: this file is the live plan for Abdu's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Mirza to Abdu" in TEAM.md.

Last updated: Sat Nov 7, evening.

## Working on now

- Nothing running. Waiting on the owner's next call.

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
