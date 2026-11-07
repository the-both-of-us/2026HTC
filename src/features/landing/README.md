# landing

The front page's working part.

- `PostingForm`: the hero card and the starter cards. Three buttons pick the input: a posting (`POST /api/maps` with `{ text }`), a PDF (`POST /api/maps/pdf` with form data `file`) or a topic (`POST /api/maps` with `{ text, kind: "topic" }`). It checks size and type first, so nobody waits for a no, and goes to `/map/[id]` when the response has `{ id }`. If the response has `{ error }` as a sentence, it shows that; otherwise a built-in message. Waiting shows real elapsed time, not fake progress. A starter card fills in its sample and builds straight away.
- `HowItWorksButton` (from `@/features/landing/client`): a short dialog on the front page and the map header. What the AI does and what code does, plus three measured figures copied from `docs/eval-results.md`. Each result screen shows its own grading time, measured on the server (`Attempt.timing`).
- `SampleFromLink`: `/?sample=<id>` fills in that sample and switches to the posting input.
