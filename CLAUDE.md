# OryxLearn

One owner. Hosting is Vercel only: pushes to `main` deploy to https://oryxlearn.vercel.app. All AI is Claude Haiku through the Anthropic SDK, with no fallback model.

Read `SPEC.md` for the product and `AGENTS.md` for the Next.js warning: this Next version differs from training data, so read `node_modules/next/dist/docs/` before using a framework API.

## Layout (feature-based, AI-native)

- `src/app/`: thin routes only. A page renders a feature; a route handler parses input and calls a feature.
- `src/features/<name>/`: `index.ts` is the public API, plus a short `README.md` and colocated `*.test.ts`. Other features import only from `@/features/<name>`, never its internals. Client components are exported from `@/features/<name>/client` when a feature has both server and client code, so server-only code stays out of client bundles.
- `src/shared/`: only code used by 2+ features. `types.ts` is the shared contract, `store/` is persistence, `identity.ts` is the anonymous user, `ui/` is the design system.

## Features

| Feature | Owns |
|---|---|
| `ai` | Claude Haiku calls: JSON and streaming, thinking profiles, timeouts, validation |
| `skill-map` | Posting, PDF or topic to validated DAG with checkpoints and verified citations; graph UI |
| `catalog` | Shared registry: each topic course and program is generated once and reused; browsing |
| `syllabus` | A catalog course's shared plan (outcomes, units, topics) |
| `programs` | A broad goal becomes a program: always a 40-course degree |
| `pretest` | Optional placement pre-test for a topic course |
| `lessons` | The Read tab lesson for a skill |
| `teachback` | Grading, integrity signals, unlocks; teach-back UI |
| `landing` | Input screen |
| `proof` | Evidence page and QR |
| `flashcards`, `quiz` | Study tools inside each node |
| `reels`, `resources`, `feed` | Videos, links and the For you feed |
| `courses` | `/courses`: browse and start the shared catalog |
| `circles`, `network` | Study circles; matching by proven skills |
| `dashboard`, `review`, `streaks` | Progress, spaced repetition, daily streak |
| `auth`, `settings`, `trust` | Optional Auth0, settings page, trust page and delete-my-data |

## Commands

- `npm run dev -- -p <port>`: use a unique port. Stop it by exact command line or PID, never a bare `pkill next`.
- `npm test`, or `npm test -- skill-map` for one feature.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Rules

- Credentials live only in `.env.local`, which is never committed: see `.env.example`. Never read keys from other folders on this machine. `PROOF_SEAL_SECRET` and the other names are listed in `README.md`.
- Tests mock the AI; spend real calls sparingly.
- Headless browser: `playwright-core` with `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- **Scripts run with `tsx`:** the `ai` and `skill-map` index files `import "server-only"`, which throws outside Next.js, so run `npx tsx --conditions=react-server scripts/x.ts` (or `npm run cache-samples`). Next.js and vitest need nothing extra. Exception: scripts that load flashcards or quiz must NOT use `--conditions=react-server` (their index files pull in next/link).
- **Git:** work on `main` and commit small. Before every push run `git pull --rebase`, then `npx tsc --noEmit && npm test`. Stage paths by name, never `git add -A`.
- **New package:** `npm i <package> --legacy-peer-deps`, and commit `package.json` and `package-lock.json` together.
