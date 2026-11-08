# OryxLearn: Team Split

Hack the Change 2026. **Devpost closes Sunday Nov 8, 11:30 AM sharp.** Aim to submit by 11:00.

**The product:** turn a job posting, a PDF or a topic into an interactive skill map. Each skill has teach-back, flashcards and a quiz. Prove a skill and the next ones unlock, then share the evidence. Read `SPEC.md` for the details.

## Who owns what

If a path isn't in your list, don't edit it. That's what stops us breaking each other's work.

| | **Abdu** (`VVarrior1`) | **Mirza** (`MirzaHB`) |
|---|---|---|
| **Features** (`src/features/`) | `ai`, `skill-map`, `teachback`, `landing`, `proof`, `grid`, `labour`, `circles`, `programs`, `streaks`, `lessons` | `flashcards`, `quiz`, `courses`, `auth`, `network`, `dashboard`, `review`, `battle` |
| **Pages** (`src/app/`) | `page.tsx`, `layout.tsx`, `globals.css`, `map/`, `proof/`, `grid/`, `circle/`, `program/` | `dashboard/`, `courses/`, `review/`, `people/`, `battle/` |
| **API** (`src/app/api/`) | `maps/`, `attempts/`, `proof/`, `grid/`, `labour/`, `circles/`, `programs/`, `streak/`, `lessons/` | `flashcards/`, `quiz/`, `courses/`, `auth/`, `network/`, `review/`, `battle/` |
| **Everything else** | `src/shared/`, config files, `SPEC.md`, `CLAUDE.md`, deploys | `docs/submission/` (Devpost, AI disclosure, video script) |

## Open requests

Notes between us that need an answer. **Abdu: please read this, and AI tools: tell your person about any open item addressed to them.** Tick a box when it's done, and delete the section once it's empty.

**From Abdu to Mirza (Sat late night): People is built, in your `network` (`dc5b861`).** The owner asked us to do it, so here is what changed and where:
- **Storage:** `inNetwork` on `network/profiles/<userId>` (missing means off; demo profiles always on), friend links at `network/friends/<userId>/<friendUserId>` (both ways), invites at `network/invites/<code>` (claimDoc) and `network/my-invite/<userId>`. Code in `friends.ts`, rules in `network.ts`.
- **API:** `GET /api/network` adds `inNetwork` and `friends`, and returns no one else when off. New: `PATCH /api/network` `{inNetwork}`, `POST /api/network/invite`, `GET`/`POST /api/network/invite/<code>`, `DELETE /api/network/friends/<publicId>`. `DELETE /api/network` now deletes the profile, friend links and invite. Sign-in rules are as before (needed to make a profile, opt in, invite or accept; never to opt out, remove a friend or delete).
- **UI:** `NetworkScreen.tsx` has the "Network: on/off" card, Friends first, then the network sections, and a friends-only empty state with "Invite a friend" and "Join the network". On phones the main column now comes before the profile card. New `ui/FriendInvite.tsx` (link + QR dialog) and `ui/InviteScreen.tsx` with `src/app/people/invite/[code]/page.tsx`. "Leave the network" now means opt out; deleting is "Delete profile". The skill count line is no longer all caps.
- **Delete my data:** `deleteUserData` now also removes friends and the invite, returning `{profiles, friends}`. Trust didn't need a change.
- README has the full storage, API and rules. `network` and `/people` are yours again.

**From Abdu to Mirza (Sat ~10:45 PM): owner's request for People, yours since it's `network`.** Owner, verbatim: "For the people tab, opt in and out of the network. If opted out you can't see anyone, it's more so a friends only/invite only social network, opt in gives you access to the network of users."

What I take that to mean (adjust as you see fit):
- [x] **Two modes on `/people`:**
  - Opted out (the default) is friends-only: you see only your friends.
  - Opted in ("Join the network") lets you see everyone who also opted in, plus your friends, and they can see you.
  - Opting out hides you from the network at once but keeps your friends.
  - Today `GET /api/network` shows everyone to anyone, so it needs gating: no profile listing unless the viewer opted in.
- [x] **Friends by invite:** "Invite a friend" makes a personal link and QR, like circles do (`/people/invite/<code>`). Opening it while signed in, or as a guest if you allow that, adds each of you to the other's friends.
  - Friends see each other's proven skills and evidence links whatever the network setting.
  - Removing a friend works both ways.
  - Keys could be `network/friends/<userId>/<friendUserId>`, written for both users, with `claimDoc` on the invite code.
  - Keep the rule that no user id or owner id ever leaves the server. Use your `publicId`.
- [x] **Empty states:** a friends-only viewer with no friends sees "Invite a friend" and "Join the network", with no other people shown.
- [x] **Delete my data** also removes friend links and invites (`trust/deleteData.ts` is mine, so tell me the function to call, or add the one line yourself, which is OK).

**Update:** built by Abdu's side (`dc5b861`), see the note above.

**From Abdu to Mirza (Sat night): what's new, and the owner's suggested tasks for you.**

New on Abdu's side, so you're not surprised:
- **Resources tab** on every skill (`features/resources`, `/api/resources`). It shows real API results only: YouTube, Wikipedia, Google Books, Taddy podcasts and GNews. Kids' maps skip news and podcasts. Results are cached for 7 days per skill.
- **"For you" feed** at `/feed` (landing tonight, in `features/feed`). It shows swipe cards of one idea each, plus educational YouTube Shorts every 4th card. Each card has like, save, share and "Prove it", which opens `/map/<id>?skill=<nodeId>` (your deep link). The sidebar gets "For you" after Build.
- **Read the Grid is gone.** You already cleaned up the docs, thanks.
- New env names, already on Vercel: `YOUTUBE_API_KEY`, `GNEWS_API_KEY`, `TADDY_API_KEY`, `TADDY_USER_ID`.

Suggested tasks for you (the owner asked me to share these), in order:
- [ ] **Flashcards and quiz at the map's level**: use `map.audience` (note below). A grade 1 map still gets adult-level cards.
- [ ] **Demo video** (your `video-script.md`), recorded once the feed is on main. Keep it about 2 to 3 minutes and focus on the core; everything else gets one line. Order:
  1. Hook: "Learn anything. Prove you get it." AI usually does the thinking for you; this checks you understand.
  2. Type anything ("grade 1 math", a job posting or a PDF) and get a program and map in seconds, pitched at the right level.
  3. Learn: the Read tab plus Resources.
  4. Prove it out loud, hands-free. It's graded in about a second against checkpoints, then comes a follow-up question. Show one other format, such as Catch the mistake, and the next topic unlocking.
  5. The final interview earns a badge, then the shareable evidence page and QR.
  6. A study circle: the live race, the "X just proved Y" toast, cheers.
  7. The For you feed, then "Prove it" from a card.
  8. One line on habit (streak, combo, fading map) and one on trust (71 graded answers: 70 matched the expected verdict, none passed a wrong answer).
- [ ] **A real phone run-through** as a brand-new user (build, feed, prove, circle). List the bugs here.
- [ ] **Devpost**: the final text, screenshots, the Team ID, and the repo going public before 11:00.
- [ ] **Pitch plan for the table rounds:** the judge scans the circle QR on their own phone and proves one topic, and our laptop shows "Judge just proved X". Have typed answers ready in case the room is too loud for voice, and demo on sample maps, which build with no AI call.

**From Abdu to Mirza (Sat late): `map.audience` exists, please use it in flashcards and quiz.**

- [ ] `SkillMap.audience?: string` (in `shared/types.ts`) says who a map is pitched at, such as `"Grade 1 students (about 6 years old)"`. Absent or empty means a general or adult learner. A topic, PDF or program that names a grade, age or school level sets it, program courses inherit it, and `getSkillMap` fills it in for older maps whose title or program names a grade. Topics, checkpoints, lessons and teach-back grading already pitch at it.
  - Flashcards and quiz still write for adults. When `map.audience` is set, add one line to their system prompts, for example: `` `The learners are: ${map.audience}. Use short sentences and words they know, everyday examples, and nothing beyond their level.` `` With no audience, leave the prompts exactly as they are. `isYoungAudience(audience)` from `@/shared/audience` says whether they are about 9 or under.
  - If you cache cards or questions by map and node, add `audienceKey(map.audience)` (same module) to the key, so cards written for adults are not served to children.

**From Mirza to Abdu (Sat evening), FYI: map header in a circle.** The owner joined a circle and found the header cluttered, with "Start a study circle" showing while already in one. `app/map/[id]/page.tsx` now passes no banner, and when `findCircleForMap` finds a circle it passes `ownerActions={<CircleLink />}` (new in `circles/client`: a small "Your circle" button to `/circle/<code>`, with the circle name in its tooltip and screen-reader text) instead of `StartCircleButton`. `StartCircleButton` is `size="sm"` now, to match Publish and Start learning. On the map, the topic badge is always the short "AI-made, no citations", with the long sentence as a tooltip. `CircleBanner` is still exported but no longer used. I checked it in a browser as the creator and as a member, and a map outside a circle still offers to start one.

**From Mirza to Abdu (Sat evening), FYI: bigger full-page reading.** At the owner's request, full page is now a wider column (`max-w-5xl`, was `3xl`) with larger type. `SkillPanel.tsx` puts `data-reading-page` on the column in full page, and `LessonTab.tsx` grows only under it (`lg:in-data-[reading-page]:` → 20px body, no 65ch cap, 24px headings). The side panel looks the same as before. If you add text to the lesson, use the same variant to keep it consistent.

**From Mirza to Abdu (Sat evening), FYI: a deep link into a skill.** The course page's skills are now clickable. They open `/map/<id>?skill=<nodeId>`, and the map opens that skill in Full page. To do that I made two small additions in your `skill-map/ui`: `MapScreen.tsx` reads `?skill=` once on load (it ignores ids that aren't on the map; closing the panel turns full page off), and `SkillPanel.tsx` takes `initialFullPage` (default false). Nothing else changed. You can use the same link anywhere, for example the dashboard or the evidence page.

**From Mirza to Abdu (Sat evening), FYI only.** In `src/shared/ui/Account.tsx` I changed the Sign out button's `-ml-3` to `-ml-0.5`, at Mirza's request. Since quiet buttons went to `px-0.5`, the `-ml-3` pushed "Sign out" 12px left of "Signed in as". It's now lined up (checked in a headless browser). Nothing else changed.

**From Mirza to Abdu (Sat Nov 7).** Flashcards, quiz and courses (with Start) are pushed. Only the header button is left:

- [x] `copySkillMap(mapId, newOwnerId): Promise<SkillMap>` exported from `@/features/skill-map`. It's for "Start this course": copy the map under a new id and owner, keep the nodes, and add `forkedFrom: mapId`. Until it exists, the course page shows "View the map" instead of "Start this course".
- [x] `listMapsByOwner(ownerId): Promise<SkillMap[]>` exported from `@/features/skill-map`, for "My courses" on the dashboard.
- [x] Private maps: `GET /api/maps/[id]` returns the map only to its owner, unless the course is published. Check with `isPublished(mapId)` from `@/features/courses`, which is coming in the courses commit. Right now anyone with a link can read any map.
- [x] Put `<PublishCourseButton mapId={id} />` from `@/features/courses/client` in the map header. It shows nothing to people who don't own the map.

**From Abdu to Mirza (Sat Nov 7).**

- [ ] **One streak, please.** The dashboard counts its own streak, so it can disagree with the map. Show `getStreak(userId)` from `@/features/streaks` instead (server only; `StreakView.count` is the days in a row, plus `best`, `doneToday` and `frozen`), and drop the dashboard's own count.
- [x] `POST /api/courses/[mapId]/start`: `copySkillMap` does not check who may read the original, so check `isPublished` (or the owner) first.
  - **Mirza: done.** Start refuses a private course with the same 404 as a missing one, and it's repeatable: one copy per learner, and "Continue this course" after that.
- [x] `/api/flashcards` and `/api/quiz` read any map by id. They should refuse a private map too, or its skills can be read through them.
  - **Mirza: done.** Only the owner, or anyone once the course is published. Refused gets the same 404 as missing, checked before any store key or AI call. Those three features' errors now extend your `HttpError`, so identity's 503 shows as a sentence.
- [x] Once `isPublished` is on main, tell Abdu: it replaces the small helper in `src/app/api/maps/[id]/access.ts`.
  - **Mirza → Abdu: done in `31fd171`.** `import { isPublished } from "@/features/courses"`: `isPublished(mapId): Promise<boolean>`, a single store read that also checks the id is a UUID. Swap it into `access.ts` whenever you like.
- [x] **Mirza → Abdu: the courses UI is live at `/courses`.** The publish button still needs placing in the map header (the unticked item above). Sample courses can now be started, so the demo can begin at `/courses`, then Start, then teach-back on your own copy. It's `PublishCourseButton` from `@/features/courses/client`, props `{ mapId }`, and it renders nothing for people who don't own the map.
  - **Abdu: done.** It's in the map header, before "Evidence page" and "Start learning". The swap to your `isPublished` in `access.ts` is done too.
- [x] **"Delete my data" needs a `deleteUserData(userId): Promise<void>` export** from `@/features/courses` (and from flashcards and quiz if they keep their own). It's live at `/trust` and `DELETE /api/my-data` (`src/features/trust/deleteData.ts`). Today it deletes my records and calls your `unpublishCourse` for the user's published maps, but it can't reach these, so the trust page says they aren't covered yet:
  - `likes/<mapId>/<userId>` (and the like counts they feed), and `course-starts/<mapId>/<userId>`.
  - `flashcards/<mapId>/<nodeId>` and `quiz/<mapId>/<nodeId>` for the user's maps. Taking `mapIds: string[]` is fine too: I call it before deleting the maps, so `listMapsByOwner(userId)` still works then.
  - Only touch that user's records, and let it run twice without failing. Tell me when it's on main and I'll call it and remove the "not covered yet" line.
  - **Mirza: done, on main.** In `deleteUserData` (trust), after `listMapsByOwner` and before deleting the maps:
    ```ts
    import { deleteUserData as deleteCourseData } from "@/features/courses";
    import { deleteForMaps as deleteFlashcards } from "@/features/flashcards";
    import { deleteForMaps as deleteQuizzes } from "@/features/quiz";
    import { forgetAccount } from "@/features/auth";
    const ids = maps.map((m) => m.id);
    const { likes, courseStarts } = await deleteCourseData(userId, ids); // also recounts the courses they liked
    await deleteFlashcards(ids); await deleteQuizzes(ids);
    await forgetAccount(userId); // the link between their Auth0 sign-in and this id
    ```
    All accept only UUIDs, touch only that user's records, and can run twice.

- [ ] **FYI, nothing to do: the skill panel has a Read tab now** (`src/features/lessons`, Abdu's). Your `FlashcardsTab` and `QuizTab` sit in tabs after it (Read, Flashcards, Quiz), above the teach-back; the props are unchanged. The tab hides each one's top rule, so drop any outer margin you add later.
- [ ] **FYI, nothing to do: study circles are on main** (`src/features/circles`, Abdu's). A map owner starts one from the map header, others join at `/circle/<code>` with their own copy of the map, and the circle page shows who proved what, live. If the dashboard lists maps, a member's copy is a normal map with `forkedFrom` set.
- [ ] **FYI for the Devpost, nothing to do: four ways to prove a topic are on main** (`src/features/teachback`). Each topic gets a format, shown as a badge on the map: "Explain it", **"Catch the mistake"** (the AI writes a confident explanation with 1 or 2 planted mistakes; you tap them and say what's true; code checks the taps, the AI checks the fixes), "Explain it to a 10-year-old" (code measures the reading level) and "Say it in 30 seconds". Once every topic is proven, a **final interview** (3 spoken or typed questions mixing topics) earns a course badge, shown on the map and the evidence page, which also says how each skill was proved.
- [x] **`/dashboard`, `/review`, `/people` and `/battle` are hidden from the sidebar** until they do more than show a heading (and `/api/review`, `/api/network` stop returning 501). Tell me when each is on main and I'll put its link back in `src/shared/ui/SideNav.tsx`, or add it yourself in the same commit.

- [ ] **FYI, the app theme is now Seal** (security-paper green `#E8EFEA`, viridian ink `#0A3A37`, Mona Sans, square corners). The tokens are in `src/app/globals.css` and keep the old names (`bg-paper`, `bg-sheet`, `text-ink`, `text-ink-soft`, `border-rule-strong`, `text-proven`…), so your pages re-themed with no edits. Please keep using the tokens and never hard-coded colours. I checked your paths (`flashcards`, `quiz`, `courses`, `network`, `dashboard`, `review`, `battle`, `auth` and their `src/app/` pages) and found no hard-coded navy, so nothing to change. `/courses` looks right in the new theme. New in `@/shared/ui`: `Tabs`, and `<Seal fingerprint size state />` if you want a seal on a card.

**From Mirza to Abdu (Sat Nov 7, evening): sign-in is on main** (`cda2f31`, optional Auth0; guests can still do everything except publish and like). These are in your files:

- [x] **Show the account status** where PageShell says "Learning as a guest": `import { AccountStatusLoader } from "@/features/auth/client"` and render `<AccountStatusLoader />` in the sidebar footer (and the phone top bar). It's a client component, because PageShell is often rendered from client screens. In a server file you can use `<Suspense><AccountStatusServer /></Suspense>` from `@/features/auth`. Both render nothing when Auth0 isn't set up. Details are under "For Abdu" in `src/features/auth/README.md`.
- [x] **`<SignInNotice />`** from `@/features/auth/client` just inside `<body>` in `layout.tsx`. It shows "Sign-in didn't finish…" after a failed or expired sign-in.
- [x] **Deploy env:** `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (a new random 32+ chars per host) and `APP_BASE_URL` (`https://oryxlearn.vercel.app` on Vercel). Mirza sends the values privately. Please add the five names with empty values to `.env.example`. For AWS, tell Mirza the URL so its `/api/auth/callback` can be added in Auth0.
- [ ] **Shared-laptop takeover (security review finding, in `identity.ts`).** Today `pf_uid` alone proves ownership. If someone copies a guest's signed `pf_uid` on a shared laptop and the next person then signs in there, the account links to that id, and the copied cookie still opens everything. Suggested fix: once an id is linked to an account (`account-of/<userId>` exists in the store), only accept that `pf_uid` together with a matching `pf_account`. A bare `pf_uid` for a linked id should count as no cookie, which gives a fresh guest. Mirza can add a helper `isLinkedUserId(userId)` to `@/features/auth` if you want it.
- [x] Sidebar links: none of `/dashboard`, `/review`, `/people` or `/battle` is ready yet. I'll add each link back in `SideNav.tsx` in the same commit that makes the page real, as you suggested.
  - **Mirza: done.** Dashboard, Review and People are back in `SideNav.tsx` (`b408697`). Battle stays out.

**From Abdu to Mirza (Sat Nov 7, late): sign-in is in the shell, plus themes.**

- [ ] **FYI, sign-in is placed.** The sidebar footer and phone menu say "Sign in" for guests (it opens a new `/sign-in` page that explains what signing in adds, then "Continue with Auth0" to `/api/auth/login?returnTo=<the page>`), and the name with "Sign out" when signed in. The phone top bar has a short "Sign in" too. It is `src/shared/ui/Account.tsx`, which calls your `GET /api/auth/session` and posts to `/api/auth/logout`; your files are unchanged. `<SignInNotice />` is in `layout.tsx` inside a Suspense (without one, `/battle/[code]` failed to prerender because of `usePathname`). The five Auth0 names are in `.env.example`.
- [ ] **FYI, three themes: Light, Dark and Eye comfort** (plus System, the default), chosen under "Appearance" in the sidebar. They override the same tokens in `globals.css`, so your pages followed with no edits: `/courses` checked in all three. Keep using tokens; QR codes use `bg-qr-paper` so they stay dark on light.

**From Mirza to Abdu (Sat Nov 7, 4:45 PM): status and two questions.**

- [ ] **Dropping `battle`?** Your study circles already give the demo its "scan a QR code, learn together, see it live" moment, so battle adds little for the time it takes. I plan to drop it and spend the time on `network`, `dashboard`, `review` and the Devpost. Say so here if you were counting on it.
- [ ] **Sample flashcards and quizzes made in advance need your AI keys** (mine aren't on this machine). I'll add a script that makes and saves them for the three sample courses, paced for the rate limit, then note here how to run it. It's a one-time run, so the demo never waits on AI for those courses. Flashcards and quiz ask Gemini first, so a `GEMINI_API_KEY` counts toward that MLH prize.
  - **Mirza: the script is on main.** Run it once from the repo root, with the store (`S3_BUCKET` or `BLOB_READ_WRITE_TOKEN`, the one the live site uses) and AI keys in `.env.local`:
    `npx tsx --env-file=.env.local src/features/courses/dev/prepareSamples.ts --dry-run` prints the plan, then run it again without `--dry-run`. That's about 84 calls, roughly 18 minutes; saved items are skipped, so it's safe to stop and rerun. **No `--conditions=react-server`** for this one (see the courses README).
- [ ] **Devpost:** I'll draft the text, the AI disclosure, the MLH categories and the 3-minute video script in `docs/submission/` from about 9-10 PM. Add anything you want mentioned (voice, PDF/topic input, evidence page, study circles, grid, trust page) here or in that folder.

**From Mirza to Abdu (Sat 5:45 PM): two more for "Delete my data", and one docs fix.**

- [x] **Delete my data** should also call these. Both accept only UUIDs, touch only that user's records, and can run twice:
  ```ts
  import { deleteUserData as deleteNetworkProfile } from "@/features/network"; // -> { profiles: 0 | 1 }; the public profile (name, city, contact link)
  import { deleteUserData as deleteReviewData } from "@/features/review";     // -> { reviewRecords }; SM-2 state and the review day log
  ```
  Call the network one early, since the profile is public. Without it, a deleted user's profile stays listed on `/people`.
  - **Abdu: done (b345c47).** Network runs first, then review; counts are in the result and the sentence, and `/trust` lists them.
- [x] **`TEAM.md` "Scripts run with `tsx` need one flag":** that's now wrong for scripts that load flashcards or quiz, because their index files pull in next/link, which breaks under `--conditions=react-server`. The sample script makes `server-only` a no-op itself instead. Maybe reword it as "most scripts", and mention the exception.
  - **Abdu: done (b345c47).** Reworded to "Most scripts" with the exception.

**From Mirza to Abdu (Sat evening): owner indexes in your storage files, as agreed.** `listMapsByOwner` and `listProgramsByOwner` no longer read every map or program.

- [ ] **FYI, please skim.** I edited `skill-map/storage.ts`, `skill-map/index.ts` (it now also exports `saveSkillMap`) and `programs/storage.ts`, with tests.
  - **How it works:** saving writes `maps-by-owner/<ownerId>/<mapId>` (and `programs-by-owner/...`), and a lookup lists only that owner's keys.
  - **Existing data:** maps and programs saved before the change are picked up by one full read the first time anyone lists them. A marker under `indexes/` then stops that read from happening again.
  - Signatures are unchanged. Details are in the skill-map README under "Finding one person's maps".
  - **Rule from now on:** save and delete maps only through `saveSkillMap` and `deleteSkillMap`. A map written with `putDoc` directly isn't indexed.
  - **Still full scans, but only in Delete my data:** `deleteProofsByOwner` (all `proofs/`), and teachback's delete (all `attempts/`, `progress/`, `final/`, `catch-revealed/`). They're rare, so they can wait.

**From Mirza to Abdu (Sat night): UI audit finding 5 (the 403) is yours, and it's harmless.**

- [x] Reproduced on a build of `main`: as a guest on a sample map, the only failing request is `GET /api/maps/<id>/progress` → 403 (owner-only, by design). `fetchProgress` in `skill-map/ui/mapApi.ts` already reads 403 as "not the owner", so nothing breaks, but the browser logs it as an error on every visit. Suggested fix: answer a non-owner with 200 `{ isOwner: false, proven: {}, unlocked: {} }` instead. The skill panel made no failing requests. `PublishCourseButton` isn't involved.
  - **Abdu: done (c91ecfb).** Exactly that shape for anyone but the owner (no map id or states, which would list a private map's node ids); the owner's answer gains `isOwner: true`; a missing map is still 404. `fetchProgress` reads `isOwner` from the body. A guest on a sample map now makes no failing request.

The rest of the list (moving types out of `shared/types.ts`, the Gemini route, `shared/http.ts`, the AWS move, the domain) is under "Asks for Abdu" in [`docs/plans/mirza.md`](docs/plans/mirza.md).

**From Abdu to Mirza (Sat Nov 7, evening): programs are on main** (`src/features/programs`, Abdu's). A broad goal, such as a job or "web development", now becomes a program of 4 to 8 courses at `/program/<id>`, each course a normal map built when it's opened.

- [ ] **List the learner's programs in `/courses`** (a "Your programs" row above the public courses, or on the dashboard if you prefer). Call it from a server component or route: `import { listMyPrograms } from "@/features/programs"`, then `await listMyPrograms(userId)` gives `{ id, title, summary, courseCount, href }[]`, newest first, with no owner id. Link each row to `href`. Programs are private, so show them only to their owner, never in the public list. A course map inside a program has `program` set (`{ id, title, courseNumber, courseCount }`), so "My courses" can group by it if you like.

**From Abdu to Mirza (Sat Nov 7, night): one streak number everywhere.**

- [ ] **The dashboard's streak** (`src/features/dashboard/streak.ts`) counts local days from proofs and reviews. The sidebar now shows a flame from `@/features/streaks` (Edmonton days, one freeze a week, counted on each proof), so the two can disagree on screen. Please show `getStreak(userId)` from `@/features/streaks` on the dashboard instead: it returns `{ count, best, doneToday, freezeReady, frozen, sparksThisWeek, combo, week }`, where `week` is Monday to Sunday. If reviews should count toward the streak too, say so here and I'll add a `recordStudied(userId, id)` hook.
- [ ] **Devpost reframe for students and curious people.** Your draft in `docs/submission/` came before programs, the Read tab, the proving formats, circles and streaks, and the final eval split (70 of 71 agree, 0 of 48 false pass, 1 of 23 false fail). Suggested replacement paragraphs are in `docs/plans/devpost-suggestions.md`. Take what helps. Devpost closes Sun 11:30 AM.

## Get started (Mirza)

```bash
git clone https://github.com/the-both-of-us/2026HTC.git
cd 2026HTC
npm install --legacy-peer-deps
cp .env.example .env.local
npm run dev
```

- **AI key:** you need your own for AI features. A Groq key works: create one at https://console.groq.com/keys and set `GROQ_API_KEY` in `.env.local`. Never commit it. `.env*` is ignored by git.
- **Storage:** with no Blob token, data lives in memory and is lost on restart. That's fine for local work.
- **After pulling, if `package.json` changed:** run `npm install --legacy-peer-deps`. Two new packages came in on Nov 7: `server-only` and `@aws-sdk/client-s3`.
- **`SESSION_SECRET`:** leave it empty locally, since a development secret is built in. Old unsigned cookies now count as no cookie, so maps you made before Nov 7 under an old cookie won't open for you. Build a new one.
- **Live site:** https://oryxlearn.vercel.app . Abdu deploys.

## Hosting

AWS (ECS Express Mode, S3) is the primary target once it's verified. Until then, Vercel stays the live fallback at https://oryxlearn.vercel.app . Abdu deploys, with `scripts/deploy-aws.sh`. The store picks its driver from the environment: `S3_BUCKET` means S3, `BLOB_READ_WRITE_TOKEN` means Blob, otherwise memory. Pushes to `main` by Abdu also go live on Vercel straight away.

**`PROOF_SEAL_SECRET`** (`openssl rand -hex 32`, set once, on every host) signs each published evidence page. Without it pages still publish, but they say the server has no seal, so an edit to the store can only be caught by a saved fingerprint.

**Using an AI coding tool?** Start it with: "Read `TEAM.md`, `CLAUDE.md` and `SPEC.md`. I'm Mirza. Only edit paths Mirza owns."

## Git rules

1. Work on `main`, and commit small and often.
2. Before every push, run `git pull --rebase`, then `npx tsc --noEmit && npm test`.
3. Stage your own paths by name. Don't use `git add -A`.
4. **New package:** pull first, run `npm i <package> --legacy-peer-deps`, commit only `package.json` and `package-lock.json`, and push straight away. If those two files conflict, take the incoming version and run the install again.
5. **Need something in the other person's files?** Message them. Don't edit it yourself.

## How the code connects

Features import each other only through `index.ts` (server code) or `client.ts` (client components). Lint enforces this.

**Most scripts run with `tsx` need one flag.** The `ai` and `skill-map` index files `import "server-only"`, which throws outside Next.js. So run scripts as `npx tsx --conditions=react-server scripts/x.ts`, or `npm run cache-samples` for the sample maps. Next.js and vitest need nothing extra. **Exception:** scripts that load flashcards or quiz must NOT use `--conditions=react-server`, because their index files pull in next/link, which breaks under it. The sample script (`src/features/courses/dev/prepareSamples.ts`) makes `server-only` a no-op itself instead.

**What Mirza can use from Abdu's code:**

```ts
import { getSkillMap, deriveNodeStates } from "@/features/skill-map";   // getSkillMap(id), deriveNodeStates(map, progress)
import { copySkillMap, listMapsByOwner } from "@/features/skill-map";   // copySkillMap(mapId, newOwnerId): Promise<SkillMap>, listMapsByOwner(ownerId): Promise<SkillMap[]>
import { getProgress } from "@/features/teachback";                     // getProgress(mapId, ownerId)
import { chatJSON, chatText, AiUnavailableError } from "@/features/ai"; // chatJSON({ prompt, schema, label })
import { getDoc, putDoc, listDocs, deleteDoc } from "@/shared/store";   // keys like "flashcards/<mapId>/<nodeId>"
import { getUserId, readUserId } from "@/shared/identity";              // getUserId in route handlers, readUserId while rendering
import { clearSession, getSession, setSessionUser } from "@/shared/identity"; // getSession(): { userId, signedIn, displayName }, safe while rendering. setSessionUser(userId, { displayName }) after sign-in. clearSession() signs out and returns a fresh guest id. Never send userId to a browser.
import { errorResponse, HttpError, parseBody } from "@/shared/http";    // parseBody(request, zodSchema), errorResponse(error, fallbackSentence?)
import { Button, Card, ComingSoon, ErrorNotice, Field, PageShell } from "@/shared/ui";
import { InlineText, ReadAloudButton } from "@/shared/ui";              // <InlineText text={modelText} /> shows `code` in backticks as code. ReadAloudButton { text, what } appears only in Accessible learning mode.
```

Your data shapes are in your own feature's `types.ts`: `Flashcard`, `QuizQuestion`, `ReviewCard`, `CourseListing`, `PeerProfile` and `BattleRoom`. They are yours to change. Types shared by several features, such as `SkillMap` and `Citation`, stay in `src/shared/types.ts`; if one of those is wrong, tell Abdu.

**What Abdu uses from Mirza's code (keep these names and props):**

| Export | Props | Where it shows |
|---|---|---|
| `FlashcardsTab` from `@/features/flashcards/client` | `{ mapId, skill }` | Skill panel on the map, already wired in |
| `QuizTab` from `@/features/quiz/client` | `{ mapId, skill }` | Skill panel on the map, already wired in |
| `PublishCourseButton` from `@/features/courses/client` | `{ mapId }` | Map header, Abdu wires it in |

Every skeleton screen is a working placeholder at its URL, so you can replace them one at a time.

## Abdu's work, in order

1. Finish and verify the core loop: map → teach-back → follow-up → unlock.
2. Bring OryxLearn's look and map screen back to where it should be.
3. Add topic and PDF input with verified citations.
4. Build the evidence page and QR code (`proof`).
5. Do the accessibility pass and trust page: delete-my-data, no serious axe violations, read-aloud.
6. Add live AESO exercises (`grid`) and StatCan numbers (`labour`).
7. Run the grading eval, deploy, and write the demo script and Q&A prep.

## Mirza's work, in order

**Status (Sat 5:45 PM):** steps 1-7 are done and on main: flashcards, quiz (both ask Gemini first), courses, auth, network (`/people`), review (`/review`, SM-2) and dashboard (`/dashboard`). The Devpost draft is in `docs/submission/`. Left: generating the samples' cards in advance (needs your keys, see below), then polish. `battle` is likely dropped.

Each step is done when it works in the running app with no raw errors on screen. The details, data shapes, cloud choices and the list of things Mirza needs from Abdu are in [`docs/plans/mirza.md`](docs/plans/mirza.md).

1. ✅ **`flashcards`:** generate cards per node with `chatJSON` and save them, so each node costs one AI call at most. Generate the sample postings' cards in advance. Flip with Space, including a keyboard-only path. Show a citation only when it is verified.
2. ✅ **`quiz`:** generate multiple-choice questions per node, saved and generated in advance the same way. Answer with keys 1-4, and explain every answer. *Done, except generating the samples' cards and questions in advance, which needs an AI key (see the open requests).* Both ask Gemini first.
3. ✅ **`courses`:** every map is a private course until its owner publishes it. Browse, like (once per user, signed in), and start someone's course, which copies it to you. Seed it with real, useful courses, never "Test Course 1".
4. ✅ **`auth`:** optional sign-in and sign-out with Auth0 (an MLH category). Never a login wall. Signing in keeps your courses on every device. Signing out starts a fresh guest.
5. ✅ **`network`:** match by proven skills. The Prompt 2 "networks" part depends on this. Any demo profile must be visibly labelled as a demo.
6. ✅ **`dashboard`:** your courses (private and public), what's proven, what's due, and your streak.
7. ✅ **`review`:** a spaced repetition queue of due flashcards using SM-2.
8. **`battle` (stretch, likely dropped):** scan a QR code and play a live quiz. Polling every 1-2 seconds is fine.
9. 🟡 **`docs/submission/`** (draft on main): the Devpost text, the AI disclosure, the MLH categories we use, and a video script that fits the 3-minute presentation. Start by 10 PM tonight.

## Timeline

- **Sat 6 PM:** Abdu's core loop is on the live site. Flashcards and quiz are pushed.
- **Sat 10 PM:** courses and network are pushed. Devpost draft started.
- **Sat midnight:** dashboard and review are pushed, and all features merged.
- **Sun 8 AM:** feature freeze. Bug fixes only.
- **Sun 9 AM:** record the video.
- **Sun 10:30 AM:** Devpost fully filled in, and the repo is switched to public.
- **Sun 11:00 AM:** submit. **11:30 is the hard deadline.**

## Don't lose on the rules

- **Write the code new.** A judge okayed using OryxLearn for features and ideas, but don't paste its code, schemas or prompts into this repo.
- **Devpost title:** `TEAM ID - TEAM NAME - PROJECT NAME`.
- **Devpost must include:** description, team members, a 2-5 minute video, the GitHub link, and all AI usage (Claude Code and the AI models). Not disclosing AI can mean disqualification. Also mention OryxLearn as the earlier project.
- **Know all of it:** both of us must be able to explain every part of the code. Being unable to can mean disqualification, so walk each other through your features on Sunday morning.
- **Be there:** both of us must attend judging in person. Judging starts around 12:45 PM in ENE 143.
- **No made-up data** is presented as real.
