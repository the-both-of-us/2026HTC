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

**What Mirza can use from Abdu's code:**

```ts
import { getSkillMap, deriveNodeStates } from "@/features/skill-map";   // getSkillMap(id), deriveNodeStates(map, progress)
import { getProgress } from "@/features/teachback";                     // getProgress(mapId, ownerId)
import { chatJSON, chatText, AiUnavailableError } from "@/features/ai"; // chatJSON({ prompt, schema, label })
import { getDoc, putDoc, listDocs, deleteDoc } from "@/shared/store";   // keys like "flashcards/<mapId>/<nodeId>"
import { getUserId } from "@/shared/identity";                          // anonymous user, in route handlers
import { Button, Card, ComingSoon, ErrorNotice, Field, PageShell } from "@/shared/ui";
```

Data shapes such as `Flashcard`, `QuizQuestion`, `ReviewCard`, `PublicCourse`, `PeerProfile` and `BattleRoom` are in `src/shared/types.ts`. If one is wrong, tell Abdu. Types only your feature uses go in your own folder.

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

Each step is done when it works in the running app with no raw errors on screen.

1. **`flashcards`:** generate cards per node with `chatJSON` and save them. Flip with Space, including a keyboard-only path. Show a citation when the card has one.
2. **`quiz`:** generate multiple-choice questions per node, answer with keys 1-4, and explain every answer.
3. **`courses`:** publish a map, browse, like (once per user), and start someone's course. Seed it with real, useful courses, never "Test Course 1".
4. **`network`:** match by proven skills. The Prompt 2 "networks" part depends on this. Any demo profile must be visibly labelled as a demo.
5. **`dashboard`:** your maps, what's proven, what's due, and your streak.
6. **`review`:** a spaced repetition queue of due flashcards using SM-2.
7. **`battle` (stretch):** scan a QR code and play a live quiz. Polling every 1-2 seconds is fine.
8. **`docs/submission/`:** the Devpost text and the 2-5 minute video script. Start by 10 PM tonight.

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
