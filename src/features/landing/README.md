# landing

The front page's working part, after the Seal prototype.

- `PostingForm`: the whole front page. The headline copy (its `children`) and the input on the left; a large ink guilloche seal on the right that redraws from what you type; then an ink band of sample postings, each with its own seal. On phones: input, samples, then the seal. Three tabs pick the input: a posting (`POST /api/maps`), a PDF (`POST /api/maps/pdf` with form data `file`) or a topic. Postings and PDFs always build one private map. Only a topic shows the size toggle (decide for me, full program, one course; a full program is always the 40-course degree), and goes to `/api/programs` (or `/api/maps` for one course). `request.ts` builds the request and reads the reply: `{ programId }` goes to `/program/[id]`, `{ mapId }` or `{ id }` to `/map/[id]`. It checks size and type first, so nobody waits for a no. If the response has `{ error }` as a sentence, it shows that; otherwise a built-in message. Waiting shows real elapsed time, not fake progress. A sample builds straight away.
- `HowItWorksButton` (from `@/features/landing/client`): a short dialog on the front page and the map header. What the AI does and what code does, plus three measured figures copied from `docs/eval-results.md`.
- `SampleFromLink`: `/?sample=<id>` fills in that sample and switches to the posting input.
