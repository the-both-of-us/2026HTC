# skill-map

Turns a job posting, a PDF or a short topic into a validated dependency graph of skills, each with checkpoints and, for a posting or PDF, a verified citation. The graph UI is in `ui/` and has its own README.

```ts
import { deriveNodeStates, generateSkillMap, getSkillMap, SkillMapError, toPublicMap } from "@/features/skill-map";

const map = await generateSkillMap({ text, kind: "posting", ownerId }); // validates, then saves it
const fromTopic = await generateSkillMap({ text: "SQL window functions", kind: "topic", ownerId });
const fromPdf = await generatePdfSkillMap({ file: bytes, ownerId });      // bytes: Uint8Array of the upload
const same = await getSkillMap(map.id);                                  // null if missing
const states = deriveNodeStates(map, progress);                          // { nodeId: "locked" | "available" | "proven" }
const copy = await copySkillMap(map.id, newOwnerId);                     // a new map with forkedFrom set, no progress. Check who may read the original first.
const mine = await listMapsByOwner(ownerId);                             // newest first
```

## How a map gets made

1. **Check the input**, or throw a `SkillMapError` with a sentence for the user:
   - posting (`build.ts`): 80 to 12,000 characters.
   - topic (`build.ts`): 2 to 120 characters, on one line.
   - PDF (`pdf.ts`): up to 4 MB (Vercel refuses bodies over 4.5 MB), 30 pages and 24,000 characters of text. `unpdf` reads the text of each page on the server. Under 80 characters means a scan or photos, and the user is told so. A password or a broken file gets its own sentence.
2. **Get model output**: saved output if the text is exactly a sample posting (`fixtures/`), otherwise one model call (`prompt.ts`). Each source sits between tags (`<posting>`, `<topic>`, or `<document>` with one `<page number="N">` per page), any copy of those tags inside it is removed, and the model is told to treat it as data and ignore any instructions inside. All three prompts share the checkpoint rules.
3. **Validate in code** (`validate.ts`), whatever the model said: clean ids, no repeats, 3 or 4 checkpoints (the prompt asks for 4), at most 14 nodes (requirements are kept over foundations), no broken links, no loops, at least one root, and every quote checked against the posting.
4. **Reject junk** (`build.ts`): if the model says it is not a posting (or the PDF teaches no skills, or the topic is not something to study), or there are under 5 nodes, or no quote checked out, the user gets a 422 with a sentence. A topic has nothing to quote, so only the node count applies.
5. **Save** to `maps/<id>` in the store, with `saveSkillMap`, which also writes the owner index entry `maps-by-owner/<ownerId>/<mapId>`.

## Citations

A quote counts as verified only if code finds it in the posting (`@/shared/quote`), ignoring case, whitespace, curly quotes and long dash styles. An unverified citation has `verified: false` and an empty `quote`, so the UI has nothing false to show. Foundations have `citation: null`.

- **PDF:** the model also names a page, and the quote must be on that page. A real quote on the wrong page is unverified. PDF text breaks lines wherever the page did, even mid-word, so a PDF quote of 12 or more letters also counts if it matches with spaces ignored (`quoteOnPdfPage`). The map keeps its pages in `sourceText`, split by `PAGE_BREAK` (a form feed), so the check can be run again. The UI then shows "Verified quote from the PDF, page 2".
- **Topic:** there is no source, so every node has `citation: null` and `fromSource: false`, whatever the model says. The map header and each skill say it is AI-generated from a topic, with no citations.

## Finding one person's maps

`listMapsByOwner(ownerId)` lists the keys under `maps-by-owner/<ownerId>/` and reads only those maps, so its cost grows with that person's maps, not with the whole store. Always save and delete through `saveSkillMap` and `deleteSkillMap`, which keep the index in step; a map written with `putDoc` directly is not indexed.

- **Catching up:** maps saved before the index existed are indexed by one full read of `maps/`, the first time anyone lists maps. The marker `indexes/maps-by-owner-v1` then says it is done, and the full read never happens again.
- **Stale entries:** an entry whose map is gone is removed when it is next read. An entry whose map names another owner is skipped, so the index can only narrow an answer, never widen it.
- Owner ids go into a key, so only plain ids (a UUID, or a fixed seed id such as `oryxlearn-sample-courses`) are indexed.

## Reading a map

Only the owner can read a map, unless it is published as a course (`isPublished` from `@/features/courses`). `GET /api/maps/[id]` and the map page check that with `canReadMap` in `src/app/api/maps/[id]/access.ts`. It sits at route level because courses imports skill-map. `getSkillMap` itself is not gated, so server code can still read a map. **Never send a full `SkillMap` to a browser:** `ownerId` is the owner's identity cookie value, so publishing it would let a reader act as them, and checkpoints are the answer key, so a reader gets only `checkpointCount`. `toPublicMap` handles both.

## The demo cache

`fixtures/*.json` hold real, unedited model replies for each sample in `src/shared/samplePostings.ts`. They go through the same validation as live replies.

```
npm run cache-samples              # only the samples with no saved file
npm run cache-samples -- --force   # all of them again
```

The script does not save a reply with an unverified citation, so run it again if it says so. `fixtures.test.ts` fails if a sample's text changes without new output being saved.

**Read the checkpoints after regenerating.** Code can check quotes but not facts, and this model sometimes states a wrong one with confidence, more often in trades and healthcare than in software. A wrong checkpoint marks a truthful learner down. That's why the prompt asks for 4 per node: a learner can miss one and still reach 70, and the follow-up then probes the one they missed.

Tests: `npm test -- skill-map`. They make no model calls. The PDF tests read real PDF files that `fixtures/makePdf.ts` writes, not mocks.
