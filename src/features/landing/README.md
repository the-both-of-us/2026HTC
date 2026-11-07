# landing

The front page's working part.

- `PostingForm`: the hero card and the starter cards. It takes a posting, sends `POST /api/maps` with `{ text }`, and goes to `/map/[id]` when the response has `{ id }`. If the response has `{ error }` as a sentence, it shows that; otherwise a built-in message. Waiting shows real elapsed time, not fake progress. A starter card fills in its sample and builds straight away.
- `HowItWorksButton` (from `@/features/landing/client`): a short dialog on the front page and the map header. What the AI does and what code does, plus three measured figures copied from `docs/eval-results.md`. Each result screen shows its own grading time, measured on the server (`Attempt.timing`).
