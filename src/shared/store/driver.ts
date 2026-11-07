/** What a storage backend must do. Documents arrive here already turned into JSON text. */
export type StoreDriver = {
  /** Returns the text, or null if there is nothing at this key. */
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  /** Removing a key that does not exist is not an error. */
  remove(key: string): Promise<void>;
};
