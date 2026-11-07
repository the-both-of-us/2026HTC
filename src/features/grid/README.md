# grid

**Owner:** Abdu. See `TEAM.md`.

"Read the Grid": a live dashboard and exercises built from AESO's public Current Supply Demand report. Every number is AESO's, or is computed from AESO's figures by code. No language model touches this feature.

- `parse.ts`: pure, tolerant parser for the report's HTML, tested against a real saved report in `fixtures/`. It throws rather than guess if a key figure is missing or the fuel rows don't add up to AESO's totals.
- `source.ts`: server only. Reads AESO at most about once a minute. If AESO fails, it returns the last good reading with its real time (`stale`), from memory or the store, or else `unavailable`.
- `exercises.ts`: builds each question and its working from one reading, and checks answers. Pure.
- `metrics.ts`: totals and formatting. `live.ts`: how the browser moves from one reading to the next.
- `ui/`: `GridScreen` renders `/grid`. `LiveGridCard` is the small card for a skill map.

**Using it elsewhere:** `import { LiveGridCard, isEnergyRelated } from "@/features/grid/client"`. `isEnergyRelated(postingText)` decides whether a map should show the card.

**Facts we checked against the report:** positive interchange means exporting (generation minus interchange equals load), and report times are Alberta time, UTC-6.

**API:** `GET /api/grid` returns a `GridReading`, with status 503 when `unavailable`.
