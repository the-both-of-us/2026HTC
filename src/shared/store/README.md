# store

JSON documents by key. This is all of the app's persistence.

```ts
import { getDoc, putDoc, listDocs, deleteDoc } from "@/shared/store";

await putDoc(`maps/${map.id}`, map);
const map = await getDoc<SkillMap>(`maps/${id}`); // null if missing
const maps = await listDocs<SkillMap>("maps/");   // the documents, not their keys
const keys = await listKeys("progress/");         // just the keys
await deleteDoc(`maps/${id}`);
```

- **Driver:** chosen from the environment, in this order:
  1. `BLOB_READ_WRITE_TOKEN` set: Vercel Blob (private).
  2. Not set: an in-memory `Map`, gone when the process restarts.
- **Fresh reads:** a read straight after a write sees the new value. The Blob driver passes `useCache: false`, which skips the CDN.
- **Keys** are stored as given, so use `/` to group documents and list them by prefix. `listDocs` reads each document with its own request, so keep prefixes narrow. Build keys from ids the server made, not from raw user input.
- **Storage failures throw** the driver's own error. Route handlers should catch it and show a human sentence.
- There are no transactions: two writers to one key means the last write wins. To let exactly one caller through, use `claimDoc(key, value)`, which returns false if the key is taken.

Each driver is one file (`memory.ts`, `blob.ts`) implementing `driver.ts`.

Tests: `npm test -- store`. They run offline.

- `once.ts` (import `@/shared/store/once`): one writer per canonical key, across instances. `startOnce(K, produce)` returns "ready" (K exists), "running" (a live claim) or `{ work }` for the winner of `claims/<K>`. A claim whose heartbeat is older than 130 s is dead and taken over (one taker, via a `~takeover-<attempt>` marker). The producer `emit`s parts; `partial/<K>` is written at most every 1.5 s plus a trailing write, and `flush()` writes now. On success K is written and the partial and claim removed; on failure both are removed so the next caller starts over. `readOnce` gives ready, planning (the parts so far), stalled or idle; `waitForOnce` polls it. Tests: `once.test.ts` (concurrent starts make one produce, a dead claim is taken over, failure cleanup).
