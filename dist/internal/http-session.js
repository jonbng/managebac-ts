import { CookieJar } from "tough-cookie";
import { NetworkError, RequestAbortedError, RequestTimeoutError, UnexpectedResponseError, } from "../errors.js";
import { assertSameOrigin } from "./url.js";
import { RateLimiter } from "./rate-limiter.js";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
function retryDelay(response, attempt, baseDelayMs, maxDelayMs) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && /^\d+$/.test(retryAfter))
        return Math.min(Number(retryAfter) * 1_000, maxDelayMs);
    if (retryAfter) {
        const retryAt = Date.parse(retryAfter);
        if (!Number.isNaN(retryAt))
            return Math.min(Math.max(0, retryAt - Date.now()), maxDelayMs);
    }
    return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}
async function wait(ms, signal) {
    if (signal?.aborted)
        throw signal.reason;
    await new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
function transportError(cause, context) {
    const details = {
        cause,
        method: context.method,
        url: context.url,
        requestId: context.requestId,
        attempts: context.attempts,
    };
    if (context.callerSignal?.aborted) {
        return new RequestAbortedError("The request was aborted by the caller.", details);
    }
    if (context.timeoutSignal.aborted) {
        return new RequestTimeoutError(`Request to ${new URL(context.url).pathname} timed out.`, details);
    }
    return new NetworkError(`Request to ${new URL(context.url).pathname} failed.`, details);
}
export class HttpSession {
    #baseUrl;
    #fetch;
    #jar = new CookieJar();
    #timeoutMs;
    #userAgent;
    #maxRetries;
    #baseDelayMs;
    #maxDelayMs;
    #retryableStatuses;
    #rateLimiter;
    #emit;
    #responseContexts = new WeakMap();
    #nextRequestId = 1;
    constructor(options) {
        if (options.fetch !== undefined && typeof options.fetch !== "function") {
            throw new TypeError("fetch must be a function.");
        }
        this.#baseUrl = options.baseUrl;
        this.#fetch = options.fetch ?? globalThis.fetch;
        this.#timeoutMs = options.timeoutMs;
        this.#userAgent = options.userAgent;
        this.#maxRetries = options.retry === false ? 0 : options.retry?.maxRetries ?? 2;
        this.#baseDelayMs = options.retry === false ? 0 : options.retry?.baseDelayMs ?? 200;
        this.#maxDelayMs = options.retry === false ? 0 : options.retry?.maxDelayMs ?? 5_000;
        this.#retryableStatuses = new Set(options.retry === false
            ? []
            : options.retry?.statuses ?? DEFAULT_RETRYABLE_STATUSES);
        this.#rateLimiter = options.rateLimiter;
        this.#emit = options.emit;
    }
    async readText(response) {
        try {
            return await response.text();
        }
        catch (cause) {
            const context = this.#responseContexts.get(response);
            if (!context)
                throw new NetworkError("Failed to read the response body.", { cause });
            throw transportError(cause, context);
        }
    }
    async request(path, init = {}) {
        const { body: _initialBody, headers: _initialHeaders, method: _initialMethod, signal: _initialSignal, ...sharedInit } = init;
        let url = assertSameOrigin(this.#baseUrl, path);
        let method = (init.method ?? "GET").toUpperCase();
        let body = init.body;
        let retryAttempt = 0;
        const requestId = this.#nextRequestId++;
        for (let redirectCount = 0; redirectCount <= 8;) {
            const headers = new Headers(init.headers);
            if (!headers.has("accept"))
                headers.set("accept", "text/html,application/xhtml+xml");
            if (!headers.has("user-agent"))
                headers.set("user-agent", this.#userAgent);
            let cookie;
            try {
                cookie = await this.#jar.getCookieString(url.href);
            }
            catch (cause) {
                throw new UnexpectedResponseError("Failed to read the in-memory session cookie jar.", {
                    cause,
                    url: url.href,
                    context: { method, requestId, attempts: retryAttempt + 1 },
                });
            }
            if (cookie)
                headers.set("cookie", cookie);
            const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
            const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
            let response;
            const startedAt = performance.now();
            this.#emit({ type: "request:start", requestId, method, url: url.href, attempt: retryAttempt + 1 });
            try {
                response = await this.#rateLimiter.run(() => this.#fetch(url, {
                    ...sharedInit,
                    ...(body === undefined ? {} : { body }),
                    headers,
                    method,
                    redirect: "manual",
                    signal,
                }), signal);
            }
            catch (cause) {
                const failure = transportError(cause, {
                    method,
                    url: url.href,
                    requestId,
                    attempts: retryAttempt + 1,
                    callerSignal: init.signal ?? undefined,
                    timeoutSignal,
                });
                this.#emit({
                    type: "request:error",
                    requestId,
                    method,
                    url: url.href,
                    attempt: retryAttempt + 1,
                    errorName: failure.name,
                    errorCode: failure.code,
                    durationMs: performance.now() - startedAt,
                });
                if (method === "GET" && retryAttempt < this.#maxRetries && !init.signal?.aborted) {
                    const delayMs = Math.min(this.#baseDelayMs * 2 ** retryAttempt, this.#maxDelayMs);
                    this.#emit({
                        type: "request:retry",
                        requestId,
                        method,
                        url: url.href,
                        status: null,
                        attempt: retryAttempt + 1,
                        delayMs,
                    });
                    try {
                        await wait(delayMs, init.signal ?? undefined);
                    }
                    catch (waitCause) {
                        throw new RequestAbortedError("The request was aborted during retry backoff.", {
                            cause: waitCause, method, url: url.href, requestId, attempts: retryAttempt + 1,
                        });
                    }
                    retryAttempt += 1;
                    continue;
                }
                throw failure;
            }
            if (!(response instanceof Response)) {
                throw new UnexpectedResponseError("The configured fetch implementation did not return a Response.", {
                    url: url.href,
                });
            }
            try {
                if (!response.url)
                    throw new TypeError("Response URL is empty.");
                assertSameOrigin(this.#baseUrl, response.url);
            }
            catch (cause) {
                throw new UnexpectedResponseError("The configured fetch implementation returned an invalid response URL.", {
                    status: response.status,
                    url: url.href,
                    cause,
                });
            }
            this.#emit({
                type: "request:end",
                requestId,
                method,
                url: url.href,
                status: response.status,
                durationMs: performance.now() - startedAt,
            });
            try {
                const setCookies = response.headers.getSetCookie();
                for (const setCookie of setCookies)
                    await this.#jar.setCookie(setCookie, url.href);
            }
            catch (cause) {
                throw new UnexpectedResponseError("ManageBac returned an invalid session cookie.", {
                    status: response.status,
                    url: url.href,
                    cause,
                });
            }
            if (method === "GET" && this.#retryableStatuses.has(response.status) && retryAttempt < this.#maxRetries) {
                const delayMs = retryDelay(response, retryAttempt, this.#baseDelayMs, this.#maxDelayMs);
                this.#emit({
                    type: "request:retry",
                    requestId,
                    method,
                    url: url.href,
                    status: response.status,
                    attempt: retryAttempt + 1,
                    delayMs,
                });
                await response.body?.cancel().catch(() => undefined);
                try {
                    await wait(delayMs, init.signal ?? undefined);
                }
                catch (waitCause) {
                    throw new RequestAbortedError("The request was aborted during retry backoff.", {
                        cause: waitCause, method, url: url.href, requestId, attempts: retryAttempt + 1,
                    });
                }
                retryAttempt += 1;
                continue;
            }
            const attempts = retryAttempt + 1;
            if (!REDIRECT_STATUSES.has(response.status)) {
                this.#responseContexts.set(response, {
                    method,
                    url: url.href,
                    requestId,
                    attempts,
                    callerSignal: init.signal ?? undefined,
                    timeoutSignal,
                });
                return response;
            }
            if (redirectCount === 8) {
                throw new UnexpectedResponseError("ManageBac returned too many redirects.", {
                    status: response.status,
                    url: url.href,
                });
            }
            const location = response.headers.get("location");
            if (!location) {
                this.#responseContexts.set(response, {
                    method,
                    url: url.href,
                    requestId,
                    attempts,
                    callerSignal: init.signal ?? undefined,
                    timeoutSignal,
                });
                return response;
            }
            try {
                url = assertSameOrigin(this.#baseUrl, new URL(location, url));
            }
            catch (cause) {
                throw new UnexpectedResponseError("ManageBac returned an unsafe or invalid redirect.", {
                    status: response.status,
                    url: url.href,
                    cause,
                });
            }
            redirectCount += 1;
            retryAttempt = 0;
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
                method = "GET";
                body = undefined;
            }
        }
        throw new UnexpectedResponseError("ManageBac returned an invalid redirect chain.");
    }
}
//# sourceMappingURL=http-session.js.map