# What Abdu's side is working on

Mirza: this file is the live plan for Abdu's side. Before starting any piece of work, we push an update here to main, so your watcher sees it first. Each line names the files it touches, so we don't collide. Questions go under "From Mirza to Abdu" in TEAM.md.

Last updated: Sun Nov 8, just after midnight.

## Working on now

The owner asked Abdu's side to build everything for now, Mirza's areas included. Everything else is unchanged, and I'll keep this file current.

- Restructuring the voiceover script into demo order (problem, solution, create a course, Read → flashcards → quiz → resources → teach-back, FYP, Network, Review), owner's request. Touches `docs/submission/voiceover-script.md` only.





## Next


- Waiting on the owner: swap the landing's "7.3% Alberta unemployment" seal for something that fits "Learn anything", or keep it. Touches `features/landing`.
- Optional: redeploy AWS from main (needs the owner's `aws login`).

## Done today (latest first)
- Put Mirza's d759362 9878ef5 live (auto-check: typecheck and tests pass).
- Put Mirza's 475d388 9b7a078 84781b3 live (auto-check: typecheck and tests pass).
- Friends: Add friend on network cards (request, accept or decline), Ping a friend (once an hour, shown on Network), friends' courses with progress bars, and a Friends and privacy section in Settings to turn off sharing progress, requests and pings.
- Delete a course: the owner gets "Delete course" on the course page (two-step, no browser dialog). `DELETE /api/maps/[id]` removes the map and its Courses listing; others' copies stay; program courses are kept (409).
- Router is two models now (owner's call from the benchmark): gpt-oss-120b by default; Claude Sonnet writes maps and lessons for hard or high-stakes courses and for psychology, health, law and quantum. Haiku and Opus are not used. The verdict is stated at the top of `/settings/models`.
- Model benchmarks at `/settings/models` (small link in Settings): 64 public MMLU/MMLU-Pro questions per model. gpt-oss-120b 85.9%, Haiku 87.5%, Sonnet 95.3%, Opus 96.9%; gpt-oss ties Claude on math and CS, Claude is clearly better on psychology, health and law.
- Model router and `/settings`: gpt-oss-120b by default; harder or higher-stakes courses use Claude Haiku, Sonnet or Opus per task (live-checked: all four tiers answer in 0.4–1.3 s). Theme, text size and learning mode moved into Settings.
- Softer colours: course covers are soft sage, mist and sand tints with ink seal lines (no more solid violet/lavender), the Dashboard and course heroes are light tints with normal buttons, the feed card has a soft rounded edge instead of a hard ink frame (interest name in teal, body in offset ink), and dark mode text is a little crisper. Checked in Chrome, light and dark.
- Put Mirza's UI refresh live (`81f2769`: Dashboard, Courses and the course page, a seal per course); the Programs section on /courses is kept; typecheck, lint and tests pass.
- Put Mirza's calmer map header live (`ce29cab`: only title and progress while a skill is open; Publish only while private); typecheck, lint and tests pass.
- Share whole programs: the owner shares from the program page (same name and sign-in rules as courses) and gets a link; anyone can open a shared program and press "Start this program" for their own copy (courses the owner already built are copied, the rest build on demand); shared programs list above courses in `/courses`. Someone else's private program is now the same 404 as a missing one. New `program-listings/<id>`, `program-starts/<id>/<user>`; routes `/api/programs/[id]/share`, `/api/programs/[id]/start`, `/api/programs/public`. Small touches in Mirza's `courses` (exports, a message option, the Programs section), noted in TEAM.md.
- Put Mirza's Quick videos redesign live (`449aef2`: modern row, full-screen viewer); typecheck, lint and tests pass.
- `/admin`: passcode-protected (`ADMIN_PASSCODE`, env only: `.env.local` and Vercel; not on AWS yet). Lists everyone (accounts and guests) with their maps, courses, programs, what they typed, proofs, feed interests, People profile and streak, plus a newest-first list of everything typed, with a filter. Signed httpOnly cookie for 8 h, 5 wrong tries lock an address for 10 min, noindex, not in the sidebar. Names show only where someone typed one (we store no email or name at sign-in, as the Trust page says).
- Read tab: lessons render light Markdown (bold key terms with a marker stroke, "- " and "1. " lists, a "> Tip:" callout, highlighted code) and each section has its own colour (idea teal, example violet, mistakes red with green fixes, checks amber), with tokens per theme in `globals.css`. New lessons are asked for it (lesson prompt hash updated); the 42 saved sample lessons got bold terms, a few lists and tips. Full page: the skill header is one slim sticky row (badges hidden on phones) and why / where it came from / built on fold into "About this skill". Also put Mirza's reel votes live (`be23fb1`) and fixed its test, which failed in the last minute of every hour (`now` and `now + 1 min` crossed the hourly claim).
- Hero seal, take 2: typing pushes it up to 420°/s (was 150), and it eases back over about a second. The faster it turns, the brighter a soft halo and a band of light that sweeps round the rim (`--color-shine` per theme; still under reduced motion). Checked in Chrome, light and dark.
- Put Mirza's reels relevance fix (`3e29d2e`) live on Vercel. Typecheck, lint and the reels tests pass on main.
- Feed sound: M (or the button) turns sound on or off, and the choice lasts for the tab's session (sessionStorage). With sound on, the next Shorts load unmuted. If the browser refuses sound before any click (say, after a reload), the Short plays muted and the first click or key press turns sound on, with no pause. The player also corrects itself if YouTube reports the wrong mute state. Checked in Chrome: M, three Shorts in a row, a reload, then a click.
- Put Mirza's Shorts inside each skill (`fd323a5`) live on Vercel. Typecheck, lint and the reels, lessons and feed tests pass on main.
- Put Mirza's Shorts redesign (`c6a19c4`) live on Vercel. Typecheck, lint and the feed tests pass on main.
- **People: friends only by default, opt in to the network** (`dc5b861`). "Network: on/off" on `/people`: off (the default, and for every profile made before tonight) shows only your friends; on adds everyone else who opted in plus the demo profiles, matched by skills as before. "Invite a friend" gives a personal link and QR (`/people/invite/<code>`), reusable until "Make a new link"; accepting makes you friends both ways (a guest with no profile just types a name). Friends see each other's proven skills and evidence whatever the setting; "Remove friend" works both ways; "Delete profile" and "Delete my data" remove friend links and the invite (inside network's own `deleteUserData`, so `trust/deleteData.ts` needed no change). Checked: typecheck, lint, all tests, a production build, and two browsers on a dev server (invite, accept, both see each other, toggle). Mirza: see TEAM.md.
- **Feed: likes on Shorts, a Both / Videos / Text switch, like counts, public comments** (`a36848b`). Shorts have the same rail as cards (like, comment, save, share) and the same engagement events; Saved lists saved Shorts. The switch is remembered per browser; Videos interleaves every interest's ranked Shorts. Like counts are real likes plus a stable demo seed of 3 to 20 (`demoLikeSeed` in `features/feed/demo.ts`; set `DEMO_LIKE_SEED` to null to remove it, ranking never sees it). Comments: plain text, newest 50, "Guest XXXX" or your signed-in name, rules plus one quick AI check (rules alone if it fails), 5 a minute, delete your own, and they go with "Delete my data" (through `deleteFeedData`, so `trust/deleteData.ts` needed no change).
- **Interest-based feed** (`3e4ebfa`): first visit picks 3+ interests (24 suggestions or your own, checked), "Edit interests" any time. Cards and Shorts live in a shared pool per interest, pre-made for all 24 suggestions (no AI call for the demo). Ranked by everyone's engagement (views, time on card, skips, likes, saves, shares, Go deeper) with a boost for new items; seen items drop and liked interests get more room. Popular pools get a new batch (once an hour) written in the vein of the best-liked cards, and the weakest well-viewed items rotate out (40 cards, 8 Shorts per interest). "Go deeper" replaces "Prove it" and opens the landing with the card's subtopic filled in. Mirza: the demo video's feed step is now "pick interests, scroll, Go deeper".
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
