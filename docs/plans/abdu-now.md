# What Abdu's side is working on

Mirza: this file is the live plan for Abdu's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Mirza to Abdu" in TEAM.md.

Last updated: Sat Nov 7, night.

## Working on now

The owner asked for all three on Abdu's side.

- New keys: `YOUTUBE_API_KEY`, `GNEWS_API_KEY`, `TADDY_API_KEY`, `TADDY_USER_ID` (in .env.local, Vercel and AWS).

## Next

- Waiting on the owner: swap the landing's "7.3% Alberta unemployment" seal for something that fits "Learn anything", or keep it. Touches `features/landing`.
- Optional: redeploy AWS from main (needs the owner's `aws login`).

## Done today (latest first)
- **"For you" feed** (`cf4b279`): `/feed` swipe-up cards, one idea each from your maps (samples for a new visitor), with like, save, share and Prove it (opens that topic's teach-back). One AI call per map, saved; sample cards are saved with the code. Every 4th item is an educational YouTube Short (SafeSearch strict, cached 5 days per topic, text only if the quota runs out). "For you" is in the sidebar after Build.
- **Resources tab on every skill** (`24b64fb`): Watch, Read, Listen and News from real APIs, cached 7 days, opened lazily; children get no news or podcasts.

- Removed "Read the Grid" at the owner's request: the sidebar link, `/grid`, `/api/grid` and the strip on energy maps. The solve store stays, so old evidence pages and data deletion still work. Mirza: please drop the Grid part of point 7 in `docs/submission/devpost.md`.
- Age-appropriate material (`63c7fa3`): a topic, PDF or program that names a grade, age or school level ("grade 1 math", "for kids", "high school chemistry") gets an audience on the map, which program courses inherit and older maps work out from their title and program. Topics, checkpoints, lessons (200 to 350 words for young children, no code) and teach-back grading are pitched at it; with no audience every prompt is byte for byte the old one (hash tests). Checked on a production build with real AI: "grade 1 math" planned 5 grade 1 strands, the first course's topics and checkpoints are child-level, the lesson has no jargon, and a childlike explanation passed (75). "SQL window functions" has no audience. Mirza: see TEAM.md for flashcards and quiz.
- Put Mirza's tidier map header in a circle (`01cd256`) live on Vercel. Typecheck, lint and the circles and skill-map tests pass on main.
- Put Mirza's wider full-page skill reading (`cdf9dbb`) live on Vercel. Typecheck, lint and the lessons, skill-map, flashcards and quiz tests pass on main.
- Put Mirza's calmer People page (`78353a5`) live on Vercel. Typecheck, lint and the network tests pass on main.
- Put Mirza's clickable People skills (`fc1925d`) live on Vercel. Typecheck, lint and the network and courses tests pass on main.
- UI audit fixes, part 2: locked map cards and list rows read clearly (5.6 to 6.3:1, dashed edge and lock, no fading) and the source tag fits inside every card (`e1b1d08`). The guest progress 403 is a 200 with `{ isOwner: false, proven: {}, unlocked: {} }`, so a sample map logs no error (`c91ecfb`).

- Study circle polish, checked with 3 browsers (owner at 1440, two members on phones):
  - Built for a projector: title, one line of members, "Invite" and "Open my map"; the shared map beside the race and the live feed, all on one screen at 1440x900 and 1280x720.
  - The whole map fits, titles 15px or more on screen, initials under each proved topic with names in the tooltip (`b1178b5`).
  - A proof shows "Sam just proved X" within about 2 s and pulses that card; history is never replayed on load. One-tap cheers, stored once per member, and "Lee cheered your proof" for the prover (`b11d9a5`).
  - Invite: a big QR code in a dialog, and "Share invite" on phones (share sheet, or a copied link that says so). A solo circle says so and points to Invite; a skeleton on first load.

- Polish pass, checked on a production build with real keys:
  - Phone map header: the map starts at 218 px on a 390x844 phone (was 385; 243 with a circle banner, was 410). The next skill plus a "More" menu with the labelled actions, the streak and today's topic on one line (`950c11b`).
  - A missing or withdrawn evidence page answers a real 404 (was 200). `src/proxy.ts` checks first, because the page streams; the owner still sees "withdrawn" (`b4c8f78`).
  - The Read tab is instant on a new map: the first open topic's lesson is written with `after()` once the map is sent. 32 ms when opened 25 s later (writing it took 14.7 s on Gemini); the map response is not slowed (`9f033bf`).
  - Dictation keyterms: the skill, the learner's words, every topic title and a short list of common tech terms, under Deepgram's 500-token limit, never checkpoints (`b260eb5`).
  - Final interview run end to end with real grading: 3 questions written in 0.9 s, 3 of 3 passed (0.4 s each), the badge shows on the map and the evidence page. Nothing needed fixing.
- Put Mirza's course page redesign (`cf57083`) live on Vercel, since his commits are blocked there. Typecheck and the courses and skill-map tests pass on main.
- UI audit fixes, part 1: /grid mix bar labels readable (5 to 6.8:1), and the Dark sample band is dark, not a pale slab.
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
