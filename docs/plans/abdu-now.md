# What Abdu's side is working on

Mirza: this file is the live plan for Abdu's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Mirza to Abdu" in TEAM.md.

Last updated: Sat Nov 7, evening.

## Working on now

- **A visible Sign in button** (owner's request): a real button at the top of the sidebar footer and an outlined button in the phone top bar, instead of an underlined link. Touches `src/shared/ui/Account.tsx` and `src/shared/ui/PageShell.tsx` only.
- **Final live check on https://oryxlearn.vercel.app** (agent, running): every proving format with real AI (Explain it, Catch the mistake, Age 10, 30 seconds, Final interview), plus programs, circles, the evidence page, themes and sign-in. It fixes bugs it finds in Abdu's paths and deletes its own test data afterwards. Bugs in your paths go to TEAM.md for you, not edited. Touches: whatever is broken, mostly `features/teachback`, `features/skill-map`, `features/proof`, `features/programs`, `features/circles`.
- **Root `README.md` for judges** (agent, running): the pitch, the loop, trust and eval numbers, architecture, how to run it, the team, AI disclosure, and prior work. Touches: `README.md` only.

## Next

- Waiting on the owner: swap the landing's "7.3% Alberta unemployment" seal for something that fits "Learn anything", or keep it. Touches `features/landing`.
- Phone map header wraps tall. Touches `features/skill-map/ui`, `features/streaks/ui`.
- Optional: redeploy AWS from main (needs the owner's `aws login`).

## Done today (latest first)

- Dark theme softened (`b250273`).
- Sign-in placed in the shell, a `/sign-in` page, and Light, Dark and Eye comfort themes (`b1399b8`).
- Map header in two short rows, map opens at full size (`e3bfe3d`, `dd032aa`).
- Review leftovers: catch answers off the evidence page, lesson fixes, circle states, topic tab first (`a6dd4f7`).
- Seal theme across the app (`61b2706`, `a5c4cfe`).
- Read tab, programs, proving formats, streaks and circles, plus their reviews.

## Freeze and submit

- Code freeze 8 AM Sunday. Submit by 11:00 (Devpost closes 11:30). Judging about 12:45, ENE 143.
