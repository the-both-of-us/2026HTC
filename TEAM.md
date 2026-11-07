# OryxLearn: Team Split

Hack the Change 2026. **Devpost closes Sunday Nov 8, 11:30 AM sharp.** Aim to submit by 11:00.

**The product:** turn a job posting, a PDF or a topic into an interactive skill map. Each skill has teach-back, flashcards and a quiz. Prove a skill and the next ones unlock, then share the evidence. Read `SPEC.md` for the details.

## Who owns what

If a path isn't in your list, don't edit it. That's what stops us breaking each other's work.

| | **Abdu** (`VVarrior1`) | **Mirza** (`MirzaHB`) |
|---|---|---|
| **Features** (`src/features/`) | `ai`, `skill-map`, `teachback`, `landing`, `proof`, `grid`, `labour` | `flashcards`, `quiz`, `courses`, `network`, `dashboard`, `review`, `battle` |
| **Pages** (`src/app/`) | `page.tsx`, `layout.tsx`, `globals.css`, `map/`, `proof/`, `grid/` | `dashboard/`, `courses/`, `review/`, `people/`, `battle/` |
| **API** (`src/app/api/`) | `maps/`, `attempts/`, `proof/`, `grid/`, `labour/` | `flashcards/`, `quiz/`, `courses/`, `network/`, `review/`, `battle/` |
| **Everything else** | `src/shared/`, config files, `SPEC.md`, `CLAUDE.md`, deploys | `docs/submission/` (Devpost, AI disclosure, video script) |

## Open requests

Notes between us that need an answer. **Abdu: please read this, and AI tools: tell your person about any open item addressed to them.** Tick a box when it's done, and delete the section once it's empty.

**From Mirza to Abdu (Sat Nov 7).** Flashcards and quiz are pushed. Courses is being built now, and these block parts of it:

- [x] `copySkillMap(mapId, newOwnerId): Promise<SkillMap>` exported from `@/features/skill-map`. It's for "Start this course": copy the map under a new id and owner, keep the nodes, and add `forkedFrom: mapId`. Until it exists, the course page shows "View the map" instead of "Start this course".
- [x] `listMapsByOwner(ownerId): Promise<SkillMap[]>` exported from `@/features/skill-map`, for "My courses" on the dashboard.
- [x] Private maps: `GET /api/maps/[id]` returns the map only to its owner, unless the course is published. Check with `isPublished(mapId)` from `@/features/courses`, which is coming in the courses commit. Right now anyone with a link can read any map.
- [ ] Put `<PublishCourseButton mapId={id} />` from `@/features/courses/client` in the map header. It shows nothing to people who don't own the map.

**From Abdu to Mirza (Sat Nov 7).**

- [ ] `POST /api/courses/[mapId]/start`: `copySkillMap` does not check who may read the original, so check `isPublished` (or the owner) first.
- [ ] `/api/flashcards` and `/api/quiz` read any map by id. They should refuse a private map too, or its skills can be read through them.
- [ ] Once `isPublished` is on main, tell Abdu: it replaces the small helper in `src/app/api/maps/[id]/access.ts`.

The rest of the list (moving types out of `shared/types.ts`, the Gemini route, `shared/http.ts`, the AWS move, the domain) is under "Asks for Abdu" in [`docs/plans/mirza.md`](docs/plans/mirza.md).

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
- **Live site:** https://proofline-tan.vercel.app . Abdu deploys.

**Using an AI coding tool?** Start it with: "Read `TEAM.md`, `CLAUDE.md` and `SPEC.md`. I'm Mirza. Only edit paths Mirza owns."

## Git rules

1. Work on `main`, and commit small and often.
2. Before every push, run `git pull --rebase`, then `npx tsc --noEmit && npm test`.
3. Stage your own paths by name. Don't use `git add -A`.
4. **New package:** pull first, run `npm i <package> --legacy-peer-deps`, commit only `package.json` and `package-lock.json`, and push straight away. If those two files conflict, take the incoming version and run the install again.
5. **Need something in the other person's files?** Message them. Don't edit it yourself.

## How the code connects

Features import each other only through `index.ts` (server code) or `client.ts` (client components). Lint enforces this.

**Scripts run with `tsx` need one flag.** The `ai` and `skill-map` index files `import "server-only"`, which throws outside Next.js. So run scripts as `npx tsx --conditions=react-server scripts/x.ts`, or `npm run cache-samples` for the sample maps. Next.js and vitest need nothing extra.

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

Each step is done when it works in the running app with no raw errors on screen. The details, data shapes, cloud choices and the list of things Mirza needs from Abdu are in [`docs/plans/mirza.md`](docs/plans/mirza.md).

1. **`flashcards`:** generate cards per node with `chatJSON` and save them, so each node costs one AI call at most. Generate the sample postings' cards in advance. Flip with Space, including a keyboard-only path. Show a citation only when it is verified.
2. **`quiz`:** generate multiple-choice questions per node, saved and generated in advance the same way. Answer with keys 1-4, and explain every answer.
3. **`courses`:** every map is a private course until its owner publishes it. Browse, like (once per user, signed in), and start someone's course, which copies it to you. Seed it with real, useful courses, never "Test Course 1".
4. **`auth`:** optional sign-in and sign-out with Auth0 (an MLH category). Never a login wall. Signing in keeps your courses on every device. Signing out starts a fresh guest.
5. **`network`:** match by proven skills. The Prompt 2 "networks" part depends on this. Any demo profile must be visibly labelled as a demo.
6. **`dashboard`:** your courses (private and public), what's proven, what's due, and your streak.
7. **`review`:** a spaced repetition queue of due flashcards using SM-2.
8. **`battle` (stretch):** scan a QR code and play a live quiz. Polling every 1-2 seconds is fine.
9. **`docs/submission/`:** the Devpost text, the AI disclosure, the MLH categories we use, and a video script that fits the 3-minute presentation. Start by 10 PM tonight.

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
