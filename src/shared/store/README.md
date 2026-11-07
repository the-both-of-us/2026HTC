# store

JSON documents by key. This is all of the app's persistence.

```ts
import { getDoc, putDoc, listDocs, deleteDoc } from "@/shared/store";

await putDoc(`maps/${map.id}`, map);
const map = await getDoc<SkillMap>(`maps/${id}`); // null if missing
const maps = await listDocs<SkillMap>("maps/");   // the documents, not their keys
await deleteDoc(`maps/${id}`);
```

- **Driver:** Vercel Blob (private) when `BLOB_READ_WRITE_TOKEN` is set, otherwise an in-memory `Map`. The in-memory data is gone when the process restarts.
- **Fresh reads:** `getDoc` passes `useCache: false`, which skips the CDN, so a read straight after a write sees the new value.
- **Keys** are stored as given, so use `/` to group documents and list them by prefix. `listDocs` reads each document with its own request, so keep prefixes narrow. Build keys from ids the server made, not from raw user input.
- **Blob failures throw** the `@vercel/blob` error. Route handlers should catch it and show a human sentence.
- There are no transactions: two writers to one key means the last write wins.

Tests: `npm test -- store` (offline, in-memory driver).
