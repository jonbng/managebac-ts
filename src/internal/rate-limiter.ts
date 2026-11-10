interface PendingTask<T> {
  readonly task: () => Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
  readonly signal: AbortSignal | undefined;
}

export class RateLimiter {
  readonly #maxConcurrent: number;
  readonly #minIntervalMs: number;
  #active = 0;
  #nextStartAt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #queue: PendingTask<unknown>[] = [];

  constructor(maxConcurrent: number, minIntervalMs: number) {
    this.#maxConcurrent = maxConcurrent;
    this.#minIntervalMs = minIntervalMs;
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({ task, resolve, reject, signal } as PendingTask<unknown>);
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#timer || this.#active >= this.#maxConcurrent) return;
    while (this.#queue[0]?.signal?.aborted) {
      const aborted = this.#queue.shift();
      aborted?.reject(aborted.signal?.reason);
    }
    const pending = this.#queue[0];
    if (!pending) return;

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
