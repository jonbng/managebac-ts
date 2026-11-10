import { ConfigurationError } from "./errors.js";
export class MemoryCacheStore {
    #entries = new Map();
    #maxEntries;
    constructor(options = {}) {
        const maxEntries = options.maxEntries ?? 100;
        if (!Number.isInteger(maxEntries) || maxEntries < 1) {
            throw new ConfigurationError("maxEntries must be a positive integer.");
        }
        this.#maxEntries = maxEntries;
    }
    get(key) {
        const value = this.#entries.get(key);
        if (value !== undefined) {
            this.#entries.delete(key);
            this.#entries.set(key, value);
        }
        return value;
    }
    set(key, value) {
        this.#entries.delete(key);
        while (this.#entries.size >= this.#maxEntries) {
            const oldest = this.#entries.keys().next().value;
            if (oldest === undefined)
                break;
            this.#entries.delete(oldest);
        }
        this.#entries.set(key, value);
    }
    delete(key) {
        this.#entries.delete(key);
    }
    clear() {
        this.#entries.clear();
    }
}
//# sourceMappingURL=cache.js.map