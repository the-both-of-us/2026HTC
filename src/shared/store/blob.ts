import { del, get, list, put } from "@vercel/blob";
import type { StoreDriver } from "./driver";

/** Vercel Blob, private. */
export const blobDriver: StoreDriver = {
  async read(key) {
    // useCache: false reads from origin storage rather than the CDN, so a read
    // straight after a write always sees the new value.
    const result = await get(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return new Response(result.stream).text();
  },

  async write(key, text) {
    await put(key, text, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  },

  async listKeys(prefix) {
    const keys: string[] = [];
    let cursor: string | undefined;

    // Blob returns results in pages, so keep asking until there are no more.
    do {
      const page = await list({ prefix, cursor });
      keys.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.cursor;
    } while (cursor);

    return keys;
  },

  async remove(key) {
    await del(key);
  },
};
