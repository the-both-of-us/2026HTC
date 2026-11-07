# landing

The front page's working part, after the Seal prototype.

- `PostingForm`: the whole front page. The headline copy (its `children`) and the input on the left; a large ink guilloche seal on the right that redraws from what you type, with `figures` in its centre; then an ink band of sample postings, each with its own seal. On phones: input, samples, then the seal. Three tabs pick the input: a posting (`POST /api/maps` with `{ text }`), a PDF (`POST /api/maps/pdf` with form data `file`) or a topic (`POST /api/maps` with `{ text, kind: "topic" }`). It checks size and type first, so nobody waits for a no, and goes to `/map/[id]` when the response has `{ id }`. If the response has `{ error }` as a sentence, it shows that; otherwise a built-in message. Waiting shows real elapsed time, not fake progress. A sample builds straight away.
- `LandingFigures` (server): Alberta's unemployment rate in the seal's centre, live from Statistics Canada via `@/features/labour`. `LandingFiguresSource` is the fine print (tables, the Calgary average, retrieval date). Both render nothing if StatCan has never answered.
- `HowItWorksButton` (from `@/features/landing/client`): a short dialog on the front page and the map header. What the AI does and what code does, plus three measured figures copied from `docs/eval-results.md`.
- `SampleFromLink`: `/?sample=<id>` fills in that sample and switches to the posting input.
