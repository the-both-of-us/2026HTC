# OryxLearn: Team Split

Hack the Change 2026. **Devpost closes Sunday Nov 8, 11:30 AM sharp.** Aim to submit by 11:00.

**The product:** turn a job posting, a PDF or a topic into an interactive skill map. Each skill has teach-back, flashcards and a quiz. Prove a skill and the next ones unlock, then share the evidence. Read `SPEC.md` for the details.

## Who owns what

If a path isn't in your list, don't edit it. That's what stops us breaking each other's work.

| | **Abdu** (`VVarrior1`) | **Mirza** (`MirzaHB`) |
|---|---|---|
| **Features** (`src/features/`) | `ai`, `skill-map`, `teachback`, `landing`, `proof`, `grid`, `labour`, `circles`, `programs`, `streaks` | `flashcards`, `quiz`, `courses`, `auth`, `network`, `dashboard`, `review`, `battle` |
| **Pages** (`src/app/`) | `page.tsx`, `layout.tsx`, `globals.css`, `map/`, `proof/`, `grid/`, `circle/`, `program/` | `dashboard/`, `courses/`, `review/`, `people/`, `battle/` |
| **API** (`src/app/api/`) | `maps/`, `attempts/`, `proof/`, `grid/`, `labour/`, `circles/`, `programs/`, `streak/` | `flashcards/`, `quiz/`, `courses/`, `auth/`, `network/`, `review/`, `battle/` |
| **Everything else** | `src/shared/`, config files, `SPEC.md`, `CLAUDE.md`, deploys | `docs/submission/` (Devpost, AI disclosure, video script) |

## Open requests

Notes between us that need an answer. **Abdu: please read this, and AI tools: tell your person about any open item addressed to them.** Tick a box when it's done, and delete the section once it's empty.

**From Mirza to Abdu (Sat Nov 7).** Flashcards, quiz and courses (with Start) are pushed. Only the header button is left:

- [x] `copySkillMap(mapId, newOwnerId): Promise<SkillMap>` exported from `@/features/skill-map`. It's for "Start this course": copy the map under a new id and owner, keep the nodes, and add `forkedFrom: mapId`. Until it exists, the course page shows "View the map" instead of "Start this course".
- [x] `listMapsByOwner(ownerId): Promise<SkillMap[]>` exported from `@/features/skill-map`, for "My courses" on the dashboard.
- [x] Private maps: `GET /api/maps/[id]` returns the map only to its owner, unless the course is published. Check with `isPublished(mapId)` from `@/features/courses`, which is coming in the courses commit. Right now anyone with a link can read any map.
- [x] Put `<PublishCourseButton mapId={id} />` from `@/features/courses/client` in the map header. It shows nothing to people who don't own the map.

**From Abdu to Mirza (Sat Nov 7).**

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

- [ ] **FYI, nothing to do: study circles are on main** (`src/features/circles`, Abdu's). A map owner starts one from the map header, others join at `/circle/<code>` with their own copy of the map, and the circle page shows who proved what, live. If the dashboard lists maps, a member's copy is a normal map with `forkedFrom` set.
- [ ] **FYI for the Devpost, nothing to do: four ways to prove a topic are on main** (`src/features/teachback`). Each topic gets a format, shown as a badge on the map: "Explain it", **"Catch the mistake"** (the AI writes a confident explanation with 1 or 2 planted mistakes; you tap them and say what's true; code checks the taps, the AI checks the fixes), "Explain it to a 10-year-old" (code measures the reading level) and "Say it in 30 seconds". Once every topic is proven, a **final interview** (3 spoken or typed questions mixing topics) earns a course badge, shown on the map and the evidence page, which also says how each skill was proved.
- [x] **`/dashboard`, `/review`, `/people` and `/battle` are hidden from the sidebar** until they do more than show a heading (and `/api/review`, `/api/network` stop returning 501). Tell me when each is on main and I'll put its link back in `src/shared/ui/SideNav.tsx`, or add it yourself in the same commit.

**From Mirza to Abdu (Sat Nov 7, evening): sign-in is on main** (`cda2f31`, optional Auth0; guests can still do everything except publish and like). These are in your files:

- [ ] **Show the account status** where PageShell says "Learning as a guest": `import { AccountStatusLoader } from "@/features/auth/client"` and render `<AccountStatusLoader />` in the sidebar footer (and the phone top bar). It's a client component, because PageShell is often rendered from client screens. In a server file you can use `<Suspense><AccountStatusServer /></Suspense>` from `@/features/auth`. Both render nothing when Auth0 isn't set up. Details are under "For Abdu" in `src/features/auth/README.md`.
- [ ] **`<SignInNotice />`** from `@/features/auth/client` just inside `<body>` in `layout.tsx`. It shows "Sign-in didn't finish…" after a failed or expired sign-in.
- [ ] **Deploy env:** `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (a new random 32+ chars per host) and `APP_BASE_URL` (`https://oryxlearn.vercel.app` on Vercel). Mirza sends the values privately. Please add the five names with empty values to `.env.example`. For AWS, tell Mirza the URL so its `/api/auth/callback` can be added in Auth0.
- [ ] **Shared-laptop takeover (security review finding, in `identity.ts`).** Today `pf_uid` alone proves ownership. If someone copies a guest's signed `pf_uid` on a shared laptop and the next person then signs in there, the account links to that id, and the copied cookie still opens everything. Suggested fix: once an id is linked to an account (`account-of/<userId>` exists in the store), only accept that `pf_uid` together with a matching `pf_account`. A bare `pf_uid` for a linked id should count as no cookie, which gives a fresh guest. Mirza can add a helper `isLinkedUserId(userId)` to `@/features/auth` if you want it.
- [x] Sidebar links: none of `/dashboard`, `/review`, `/people` or `/battle` is ready yet. I'll add each link back in `SideNav.tsx` in the same commit that makes the page real, as you suggested.
  - **Mirza: done.** Dashboard, Review and People are back in `SideNav.tsx` (`b408697`). Battle stays out.

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

The rest of the list (moving types out of `shared/types.ts`, the Gemini route, `shared/http.ts`, the AWS move, the domain) is under "Asks for Abdu" in [`docs/plans/mirza.md`](docs/plans/mirza.md).

**From Abdu to Mirza (Sat Nov 7, evening): programs are on main** (`src/features/programs`, Abdu's). A broad goal, such as a job or "web development", now becomes a program of 4 to 8 courses at `/program/<id>`, each course a normal map built when it's opened.

- [ ] **List the learner's programs in `/courses`** (a "Your programs" row above the public courses, or on the dashboard if you prefer). Call it from a server component or route: `import { listMyPrograms } from "@/features/programs"`, then `await listMyPrograms(userId)` gives `{ id, title, summary, courseCount, href }[]`, newest first, with no owner id. Link each row to `href`. Programs are private, so show them only to their owner, never in the public list. A course map inside a program has `program` set (`{ id, title, courseNumber, courseCount }`), so "My courses" can group by it if you like.

**From Abdu to Mirza (Sat Nov 7, night): one streak number everywhere.**

- [ ] **The dashboard's streak** (`src/features/dashboard/streak.ts`) counts local days from proofs and reviews. The sidebar now shows a flame from `@/features/streaks` (Edmonton days, one freeze a week, counted on each proof), so the two can disagree on screen. Please show `getStreak(userId)` from `@/features/streaks` on the dashboard instead: it returns `{ count, best, doneToday, freezeReady, frozen, sparksThisWeek, combo, week }`, where `week` is Monday to Sunday. If reviews should count toward the streak too, say so here and I'll add a `recordStudied(userId, id)` hook.

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
