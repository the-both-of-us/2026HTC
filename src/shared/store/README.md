# store

JSON documents by key. This is all of the app's persistence.

```ts
import { getDoc, putDoc, listDocs, deleteDoc } from "@/shared/store";

await putDoc(`maps/${map.id}`, map);
const map = await getDoc<SkillMap>(`maps/${id}`); // null if missing
const maps = await listDocs<SkillMap>("maps/");   // the documents, not their keys
await deleteDoc(`maps/${id}`);
```

- **Driver:** chosen from the environment, in this order:
  1. `S3_BUCKET` set: Amazon S3, using the default AWS credentials (the task role on AWS) and `AWS_REGION`.
  2. `BLOB_READ_WRITE_TOKEN` set: Vercel Blob (private).
  3. Neither: an in-memory `Map`, gone when the process restarts.
- **Fresh reads:** a read straight after a write sees the new value. S3 is strongly consistent, and the Blob driver passes `useCache: false`, which skips the CDN.
- **S3 permissions:** the role needs `s3:ListBucket` as well as get, put and delete. Without it, S3 reports a missing key as AccessDenied instead of NoSuchKey, so `getDoc` throws instead of returning null.
- **Keys** are stored as given, so use `/` to group documents and list them by prefix. `listDocs` reads each document with its own request, so keep prefixes narrow. Build keys from ids the server made, not from raw user input.
- **Storage failures throw** the driver's own error. Route handlers should catch it and show a human sentence.
- There are no transactions: two writers to one key means the last write wins.

Each driver is one file (`memory.ts`, `blob.ts`, `s3.ts`) implementing `driver.ts`.

Tests: `npm test -- store`. They run offline: the S3 test mocks the AWS SDK.
