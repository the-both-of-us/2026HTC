# skill-map

Turns a job posting into a validated dependency graph of skills, each with checkpoints and a verified citation. The graph UI is in `ui/` and has its own README.

```ts
import { deriveNodeStates, generateSkillMap, getSkillMap, SkillMapError, toPublicMap } from "@/features/skill-map";

const map = await generateSkillMap({ text, kind: "posting", ownerId }); // validates, then saves it
const same = await getSkillMap(map.id);                                  // null if missing
const states = deriveNodeStates(map, progress);                          // { nodeId: "locked" | "available" | "proven" }
```

## How a map gets made

1. **Check the input** (`build.ts`): 80 to 12,000 characters, or a `SkillMapError` with a sentence for the user.
2. **Get model output**: saved output if the text is exactly a sample posting (`fixtures/`), otherwise one model call (`prompt.ts`). The posting sits between `<posting>` tags, and the model is told to treat it as data and ignore any instructions inside.
3. **Validate in code** (`validate.ts`), whatever the model said: clean ids, no repeats, 3 or 4 checkpoints, at most 14 nodes (requirements are kept over foundations), no broken links, no loops, at least one root, and every quote checked against the posting.
4. **Reject junk** (`build.ts`): if the model says it is not a posting, or there are under 5 nodes, or no quote checked out, the user gets a 422 with a sentence.
5. **Save** to `maps/<id>` in the store.

## Citations

A quote counts as verified only if code finds it in the posting, ignoring case, whitespace, curly quotes and long dash styles. An unverified citation has `verified: false` and an empty `quote`, so the UI has nothing false to show. Foundations have `citation: null`.

## Reading a map

Anyone with the id can read a map through `GET /api/maps/[id]`, which returns `toPublicMap(map)`. **Never send a full `SkillMap` to a browser:** `ownerId` is the owner's identity cookie value, so publishing it would let a reader act as them, and checkpoints are the answer key, so a reader gets only `checkpointCount`.

## The demo cache

`fixtures/*.json` hold real, unedited model replies for each sample in `src/shared/samplePostings.ts`. They go through the same validation as live replies.

```
npx tsx scripts/cache-samples.ts           # only the samples with no saved file
npx tsx scripts/cache-samples.ts --force   # all of them again
```

The script does not save a reply with an unverified citation, so run it again if it says so. `fixtures.test.ts` fails if a sample's text changes without new output being saved.

**Read the checkpoints after regenerating.** Code can check quotes but not facts, and this model sometimes states a wrong one with confidence. A wrong checkpoint marks a truthful learner down.

Tests: `npm test -- skill-map`. They make no model calls.
