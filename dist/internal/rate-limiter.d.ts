export declare class RateLimiter {
    #private;
    constructor(maxConcurrent: number, minIntervalMs: number);
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
//# sourceMappingURL=rate-limiter.d.ts.map