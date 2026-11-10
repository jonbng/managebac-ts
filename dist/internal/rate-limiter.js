export class RateLimiter {
    #maxConcurrent;
    #minIntervalMs;
    #active = 0;
    #nextStartAt = 0;
    #timer;
    #queue = [];
    constructor(maxConcurrent, minIntervalMs) {
        this.#maxConcurrent = maxConcurrent;
        this.#minIntervalMs = minIntervalMs;
    }
    run(task, signal) {
        if (signal?.aborted)
            return Promise.reject(signal.reason);
        return new Promise((resolve, reject) => {
            this.#queue.push({ task, resolve, reject, signal });
            this.#drain();
        });
    }
    #drain() {
        if (this.#timer || this.#active >= this.#maxConcurrent)
            return;
        while (this.#queue[0]?.signal?.aborted) {
            const aborted = this.#queue.shift();
            aborted?.reject(aborted.signal?.reason);
        }
        const pending = this.#queue[0];
        if (!pending)
            return;
        const delay = Math.max(0, this.#nextStartAt - Date.now());
        if (delay > 0) {
            this.#timer = setTimeout(() => {
                this.#timer = undefined;
                this.#drain();
            }, delay);
            return;
        }
        this.#queue.shift();
        this.#active += 1;
        this.#nextStartAt = Date.now() + this.#minIntervalMs;
        void pending.task().then(pending.resolve, pending.reject).finally(() => {
            this.#active -= 1;
            this.#drain();
        });
        this.#drain();
    }
}
//# sourceMappingURL=rate-limiter.js.map