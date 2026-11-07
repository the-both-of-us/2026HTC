# grid

**Owner:** Abdu. See `TEAM.md`.

"Read the Grid": a live dashboard and exercises built from AESO's public Current Supply Demand report. Every number is AESO's, or is computed from AESO's figures by code. No language model touches this feature.

- `parse.ts`: pure, tolerant parser for the report's HTML, tested against a real saved report in `fixtures/`. It throws rather than guess if a key figure is missing or the fuel rows don't add up to AESO's totals.
- `source.ts`: server only. Reads AESO at most about once a minute. If AESO fails, it returns the last good reading with its real time (`stale`), from memory or the store, or else `unavailable`.
- `exercises.ts`: builds each question and its working from one reading, and checks answers. Pure.
- `solves.ts`: server only. `sealReading` signs each reading the server hands out (an HMAC with `SESSION_SECRET`). When a learner answers a question right before opening the working, the browser sends the answer back with that reading. `recordSolve` checks the signature, rebuilds the question with the same code, checks the answer, and only then saves it at `grid-solves/<userId>/<exerciseId>`, newest answer wins. A report over 15 minutes old when it was solved is saved as `stale`. `listGridSolves(userId)` is what `proof` reads for an energy map.
- `metrics.ts`: totals and formatting. `live.ts`: how the browser moves from one reading to the next.
- `ui/`: `GridScreen` renders `/grid`. `LiveGridCard` is the small card for a skill map.

**Using it elsewhere:** `import { LiveGridCard, LiveGridStrip } from "@/features/grid/client"`. Whether a map shows them is decided in `skill-map`, by `isEnergyRelated(postingText)`.

**Facts we checked against the report:** positive interchange means exporting (generation minus interchange equals load), and report times are Alberta time, UTC-6.

**API:** `GET /api/grid` returns a `GridReading` with its `seal`, with status 503 when `unavailable`. `POST /api/grid/solves` takes `{ exerciseId, answer, reading: { snapshot, fetchedAt, seal } }` and returns `{ solve }`, or 400 for figures we didn't sign and 422 for a wrong answer.
