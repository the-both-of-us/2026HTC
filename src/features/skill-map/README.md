# skill-map

Turns a job posting or a PDF into a validated dependency graph of skills, each with checkpoints and a verified citation, and holds every learner map, including maps of catalog courses (topics), which are built unit by unit from a canonical syllabus. The graph UI is in `ui/` and has its own README.

```ts
import { deriveNodeStates, generateSkillMap, getSkillMap, SkillMapError, toPublicMap } from "@/features/skill-map";

const map = await generateSkillMap({ text, ownerId });                  // a posting: validates, then saves it
const fromPdf = await generatePdfSkillMap({ file: bytes, ownerId });      // bytes: Uint8Array of the upload
const same = await getSkillMap(map.id);                                  // null if missing
const states = deriveNodeStates(map, progress);                          // { nodeId: "locked" | "available" | "proven" }
const copy = await copySkillMap(map.id, newOwnerId);                     // a new map with forkedFrom set, no progress. Check who may read the original first.
const mine = await listMapsByOwner(ownerId);                             // newest first
```

## How a map gets made

1. **Check the input**, or throw a `SkillMapError` with a sentence for the user:
   - posting (`build.ts`): 80 to 12,000 characters.
   - topic name (`checkTopicText`, used by the catalog before it plans a course): 2 to 120 characters, on one line.
   - PDF (`pdf.ts`): up to 4 MB (Vercel refuses bodies over 4.5 MB), 30 pages and 24,000 characters of text. `unpdf` reads the text of each page on the server. Under 80 characters means a scan or photos, and the user is told so. A password or a broken file gets its own sentence.
2. **Get model output**: saved output if the text is exactly a sample posting (`fixtures/`), otherwise one model call (`prompt.ts`). Each source sits between tags (`<posting>`, or `<document>` with one `<page number="N">` per page), any copy of those tags inside it is removed, and the model is told to treat it as data and ignore any instructions inside. The prompts share the checkpoint rules.
3. **Validate in code** (`validate.ts`), whatever the model said: clean ids, no repeats, 3 or 4 checkpoints (the prompt asks for 4), at most 14 nodes (units have their own limits, below) (requirements are kept over foundations), no broken links, no loops, at least one root, and every quote checked against the posting.
4. **Reject junk** (`build.ts`): if the model says it is not a posting (or the PDF teaches no skills, or the topic is not something to study), or there are under 5 nodes, or no quote checked out, the user gets a 422 with a sentence. A topic has nothing to quote, so only the node count applies.
5. **Save** to `maps/<id>` in the store, with `saveSkillMap`, which also writes the owner index entry `maps-by-owner/<ownerId>/<mapId>`.

## Who a map is for

`map.audience` (such as "Grade 1 students (about 6 years old)") pitches a map at a grade or age. It comes from the program plan's `audience`, or `inferAudience` in `src/shared/audience.ts` for a topic or the start of a PDF that names a grade, age or school level. Program courses inherit it, and `getSkillMap` works it out for older maps from their title and program title. With an audience, the PDF and unit prompts get an AUDIENCE section and teacher-level checkpoint rules; with none, they are byte for byte the old prompts (`audience.test.ts` checks the hashes). Postings never get one.

## Catalog courses (wave 2)

A topic is never a flat map any more: it is a catalog course (`@/features/catalog`) with a canonical syllabus, and each learner's map (`maps/<id>`) points at it with `courseId`. Everything generated for it is written once and shared by every learner of the course.

```ts
contentIdOf(map);                                   // courseId ?? id: the id every shared content key uses
await ensureUnitNodes({ contentId, unitId, syllabus, course, deadline }); // "ready" + nodes | "running" | "no-time"
const { map, build } = await syncCourseMap(map);    // appends unit 1 once it exists (zero calls); build state for the page
const result = await generateUnit(map, "u2", viewerId); // { status: "ready", map } | { status: "building" }; no call in the request
```

- **Content ids.** Unit nodes, lessons, quiz, flashcards, catch rounds and resources are keyed by `contentIdOf(map)`. A posting or PDF map has no `courseId`, so its content stays under its own map id, exactly as before. Deletes keep taking map ids, so "Delete my data" never touches canonical content.
- **The syllabus is attached on read.** `saveSkillMap` strips `syllabus` and `rating` from a map with a `courseId`. `getSkillMap` attaches the canonical syllabus (`readCatalogSyllabus`), or the partial one with `planning: true` while it is being written, shaped by `syllabusForLearner`: `built` comes from the learner's own nodes, a built unit's topics are cut to those with a node, `rootMapId` is the courseId. One more read per map.
- **Units.** `ensureUnitNodes` writes `unit-nodes/<contentId>/<unitId>` once under `startOnce` (`@/shared/store/once`): one `chatJSON` on the plan profile (16k tokens, at most 60 s), plus a repair call for missing topics when the deadline leaves 20 s. It starts nothing when the deadline cannot fit 60 s. Node ids equal topic ids, and the syllabus fields come from code (`validateUnitNodes`). Appending to a learner map (`appendUnit`) holds `unit-claims/<mapId>` for a few store operations (dead after 30 s).
- **No call in a request.** `generateUnit` appends the canonical unit when it exists, says "building" while someone writes it, and otherwise starts the build after the response (`inBackground`, Next's `after()`). `syncCourseMap` (called by `GET /api/maps/[id]` and the map page) appends unit 1 as soon as it exists.
- **Pre-generation rule 3.** Whenever unit k is appended for any learner, the canonical build of unit k+1 starts after the response, unless it exists or is running.
- **Copies.** `copySkillMap` spreads the source, so a copy keeps `courseId` and shares every piece of content.
- **Removed:** the topic and course map prompts (`generateCourseMap`, the flat topic path), `generateSyllabusMap`, the per-map unit cache and the `forkedFrom` fallback.
- **`skillBlock(map, node)`** and the unit rail (`unitView.ts`, `ui/UnitRail.tsx`) work on the attached syllabus exactly as before. `toPublicMap(map, build)` adds `syllabus` without `rootMapId`, and `build` for a catalog map.
- **Background work** (`background.ts`): `inBackground` runs a task with `after()` (or at once outside a request); `routeDeadline()` is the request start plus 112 s.
- Tests use `@/shared/store/onceFake` as a stand-in for `@/shared/store/once`.

## Model

Every call uses the plan profile of `@/features/ai` (Claude Haiku, adaptive thinking at effort high): a posting or PDF map 32k tokens and 100 s, a unit 16k and 60 s. No map stores a `rating` any more.

## Citations

A quote counts as verified only if code finds it in the posting (`@/shared/quote`), ignoring case, whitespace, curly quotes and long dash styles. An unverified citation has `verified: false` and an empty `quote`, so the UI has nothing false to show. Foundations have `citation: null`.

- **PDF:** the model also names a page, and the quote must be on that page. A real quote on the wrong page is unverified. PDF text breaks lines wherever the page did, even mid-word, so a PDF quote of 12 or more letters also counts if it matches with spaces ignored (`quoteOnPdfPage`). The map keeps its pages in `sourceText`, split by `PAGE_BREAK` (a form feed), so the check can be run again. The UI then shows "Verified quote from the PDF, page 2".
- **Catalog course:** there is no source, so every unit node has `citation: null` and `fromSource: false`, whatever the model says. The map header and each skill say it is AI-generated, with no citations.

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

- **Wave 2 contract (WP0):** `contentIdOf(map)` (`courseId ?? id`) keys all shared content; `ensureUnitNodes` and `syncCourseMap` (`canonical.ts`, stubs until WP-C); route shapes and `CourseBuildState` in `types.ts`; `PublicSkillMap.build`.

**Pre-test:** `unitRail` takes an optional fourth argument, the learner's `proven` record: an unbuilt unit then counts topics already proved (only a course pre-test pass can do that), as the map's marks and unlock counts need.

**Pre-test UI (Nov 11):** the map screen owns where the pre-test (`@/features/pretest/client`) sits: an offer strip while nothing is proved, a header button, and the pre-test screen in place of the map. A topic whose `proven[id]` is "pretest" is marked "Known (pre-test)" on its map card (a plain tick, no evidence seal), in All Skills, on the unit rail ("n known", also for unbuilt units) and in the skill panel. `MapCanvas` and `SkillList` take `knownIds`; `UnitRail` takes `knownCounts`; `SkillPanel` takes `knownIds` and passes `pretest` to the teach-back panel. The pre-test end screen shows the map's `NextStepView` (exported from SkillPanel), so it agrees with the header button. `computeNextStep` (`nextStep.ts`) drives the after-proof notice, the Read tab (`LessonTab` `nextStep` slot) and the header button; `LessonTab`'s `reselect` prop restarts a failed lesson when its topic is selected again.
