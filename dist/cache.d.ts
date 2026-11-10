import type { CacheStore } from "./types.js";
export declare class MemoryCacheStore implements CacheStore {
    #private;
    constructor(options?: {
        maxEntries?: number;
    });
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    clear(): void;
}
//# sourceMappingURL=cache.d.ts.map