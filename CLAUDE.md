# OryxLearn

**Two people work here. Read `TEAM.md` first and only edit paths your person owns.**

Read `SPEC.md` for the product and `AGENTS.md` for the Next.js warning: this Next version differs from training data, so read `node_modules/next/dist/docs/` before using a framework API.

## Layout (feature-based, AI-native)

- `src/app/`: thin routes only. A page renders a feature; a route handler parses input and calls a feature.
- `src/features/<name>/`: `index.ts` is the public API, plus a short `README.md` and colocated `*.test.ts`. Other features import only from `@/features/<name>`, never its internals. Client components are exported from `@/features/<name>/client` when a feature has both server and client code, so server-only code stays out of client bundles.
- `src/shared/`: only code used by 2+ features. `types.ts` is the shared contract, `store/` is persistence, `identity.ts` is the anonymous user, `ui/` is the design system.

## Features

| Feature | Owns |
|---|---|
| `ai` | Provider chain, JSON and streaming calls, timeouts, validation |
| `skill-map` | Posting or PDF to validated DAG with checkpoints and verified citations; graph UI |
| `teachback` | Grading, follow-up, integrity signals, unlocks; teach-back UI |
| `landing` | Input screen |
| `proof` | Evidence page and QR |
| `grid` | AESO live data exercises |
| `labour` | StatCan numbers |
| `flashcards`, `quiz` | Study tools inside each node |
| `courses` | Public directory |
| `network` | Matching by proven skills |
| `dashboard`, `review` | Progress and spaced repetition |
| `battle` | QR quiz battle |

## Commands

- `npm run dev -- -p <port>`: use a unique port. Stop it by exact command line or PID, never a bare `pkill next`.
- `npm test`, or `npm test -- skill-map` for one feature.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Rules

- Credentials live only in `.env.local`, which is never committed: see `.env.example` and `TEAM.md`. Never read keys from other folders on this machine.
- The AI gateway free tier allows about 5 requests a minute per model. Tests mock the AI; spend real calls sparingly.
- Headless browser: `playwright-core` with `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Stage your own paths by name, and follow the git rules in `TEAM.md`.
