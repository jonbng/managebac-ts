import type { CacheStore } from "./types.js";
import { ConfigurationError } from "./errors.js";

export class MemoryCacheStore implements CacheStore {
  readonly #entries = new Map<string, unknown>();
  readonly #maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    const maxEntries = options.maxEntries ?? 100;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new ConfigurationError("maxEntries must be a positive integer.");
    }
    this.#maxEntries = maxEntries;
  }

  get(key: string): unknown {
    const value = this.#entries.get(key);
    if (value !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: unknown): void {
    this.#entries.delete(key);
    while (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, value);
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
