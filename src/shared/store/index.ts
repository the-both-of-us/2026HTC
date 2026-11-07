import { blobDriver } from "./blob";
import type { StoreDriver } from "./driver";
import { memoryDriver } from "./memory";
import { s3Driver } from "./s3";

/**
 * A small JSON document store. The driver depends on the environment:
 * S3_BUCKET means S3, then BLOB_READ_WRITE_TOKEN means Vercel Blob, otherwise memory.
 * Values go through JSON, so callers always get a fresh copy, never a stored object.
 */
function driver(): StoreDriver {
  if (process.env.S3_BUCKET) return s3Driver;
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobDriver;
  return memoryDriver;
}

/** Returns the document, or null if there is none at this key. */
export async function getDoc<T>(key: string): Promise<T | null> {
  const text = await driver().read(key);
  return text === null ? null : (JSON.parse(text) as T);
}

/** Creates the document, or replaces it if the key already exists. */
export async function putDoc(key: string, value: unknown): Promise<void> {
  await driver().write(key, JSON.stringify(value));
}

/** Creates the document only if the key is free. Returns false if someone got there first. */
export async function claimDoc(key: string, value: unknown): Promise<boolean> {
  return driver().create(key, JSON.stringify(value));
}

/** Returns every key that starts with the prefix, for when the key itself says whose a document is. */
export async function listKeys(prefix: string): Promise<string[]> {
  return driver().listKeys(prefix);
}

/** Returns every document whose key starts with the prefix. */
export async function listDocs<T>(prefix: string): Promise<T[]> {
  const keys = await driver().listKeys(prefix);
  const docs = await Promise.all(keys.map((key) => getDoc<T>(key)));
  // A document can be deleted between listing it and reading it.
  return docs.filter((doc): doc is Awaited<T> => doc !== null);
}

/** Removes the document. Deleting a key that does not exist is not an error. */
export async function deleteDoc(key: string): Promise<void> {
  await driver().remove(key);
}
