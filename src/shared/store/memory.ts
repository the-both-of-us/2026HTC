import type { StoreDriver } from "./driver";

/**
 * Keeps documents in this process, so tests and offline work need no setup.
 *
 * It sits on globalThis because Next.js can load this file more than once (one
 * copy per route), and they must all share one Map.
 */
const globalStore = globalThis as typeof globalThis & { pfMemoryStore?: Map<string, string> };
const memory = (globalStore.pfMemoryStore ??= new Map<string, string>());

export const memoryDriver: StoreDriver = {
  async read(key) {
    return memory.get(key) ?? null;
  },
  async write(key, text) {
    memory.set(key, text);
  },
  async create(key, text) {
    if (memory.has(key)) return false;
    memory.set(key, text);
    return true;
  },
  async listKeys(prefix) {
    return [...memory.keys()].filter((key) => key.startsWith(prefix));
  },
  async remove(key) {
    memory.delete(key);
  },
};
