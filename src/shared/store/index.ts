import { BlobError, del, get, list, put } from "@vercel/blob";

/**
 * A small JSON document store.
 *
 * With BLOB_READ_WRITE_TOKEN set, documents live in Vercel Blob.
 * Without it, they live in memory, so tests and offline work need no setup.
 */

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * The in-memory fallback. It sits on globalThis because Next.js can load this
 * file more than once (one copy per route), and they must all share one Map.
 * Values are stored as JSON strings so it behaves the same as Blob: callers
 * always get a fresh copy, never a reference to the stored object.
 */
const globalStore = globalThis as typeof globalThis & { pfMemoryStore?: Map<string, string> };
const memory = (globalStore.pfMemoryStore ??= new Map<string, string>());

/** Returns the document, or null if there is none at this key. */
export async function getDoc<T>(key: string): Promise<T | null> {
  if (!hasBlobToken()) {
    const text = memory.get(key);
    return text === undefined ? null : (JSON.parse(text) as T);
  }

  // useCache: false reads from origin storage rather than the CDN, so a read
  // straight after a write always sees the new value.
  const result = await get(key, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;

  const text = await new Response(result.stream).text();
  return JSON.parse(text) as T;
}

/** Creates the document, or replaces it if the key already exists. */
export async function putDoc(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);

  if (!hasBlobToken()) {
    memory.set(key, text);
    return;
  }

  await put(key, text, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

/**
 * Creates the document only if the key is empty, and says whether it did. Two requests
 * racing for the same key can't both get true, so this works as a one-time claim.
 */
export async function putDocIfAbsent(key: string, value: unknown): Promise<boolean> {
  const text = JSON.stringify(value);

  if (!hasBlobToken()) {
    if (memory.has(key)) return false;
    memory.set(key, text);
    return true;
  }

  try {
    await put(key, text, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
    });
    return true;
  } catch (error) {
    // Blob has no error class of its own for this, only this message.
    if (error instanceof BlobError && /already exists/i.test(error.message)) return false;
    throw error;
  }
}

/** Returns every document whose key starts with the prefix. */
export async function listDocs<T>(prefix: string): Promise<T[]> {
  const keys = hasBlobToken() ? await listBlobKeys(prefix) : listMemoryKeys(prefix);
  const docs = await Promise.all(keys.map((key) => getDoc<T>(key)));
  // A document can be deleted between listing it and reading it.
  return docs.filter((doc): doc is Awaited<T> => doc !== null);
}

/** Removes the document. Deleting a key that does not exist is not an error. */
export async function deleteDoc(key: string): Promise<void> {
  if (!hasBlobToken()) {
    memory.delete(key);
    return;
  }

  await del(key);
}

function listMemoryKeys(prefix: string): string[] {
  return [...memory.keys()].filter((key) => key.startsWith(prefix));
}

async function listBlobKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  // Blob returns results in pages, so keep asking until there are no more.
  do {
    const page = await list({ prefix, cursor });
    keys.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.cursor;
  } while (cursor);

  return keys;
}
