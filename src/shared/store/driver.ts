/** What a storage backend must do. Documents arrive here already turned into JSON text. */
export type StoreDriver = {
  /** Returns the text, or null if there is nothing at this key. */
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  /**
   * Writes only if the key is free, and says whether it did. The backend decides this
   * in one step, so of many callers at the same moment exactly one gets true.
   */
  create(key: string, text: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
  /** Removing a key that does not exist is not an error. */
  remove(key: string): Promise<void>;
};
