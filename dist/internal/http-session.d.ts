import { RateLimiter } from "./rate-limiter.js";
import type { FetchImplementation, RetryOptions, SerializedCookieJar } from "../types.js";
import type { EmitEvent } from "./observability.js";
interface HttpSessionOptions {
    baseUrl: string;
    fetch?: FetchImplementation;
    timeoutMs: number;
    userAgent: string;
    retry?: false | RetryOptions;
    rateLimiter: RateLimiter;
    emit: EmitEvent;
    session?: SerializedCookieJar;
}
export declare class HttpSession {
    #private;
    constructor(options: HttpSessionOptions);
    exportSession(): Promise<SerializedCookieJar>;
    readText(response: Response): Promise<string>;
    request(path: string | URL, init?: RequestInit): Promise<Response>;
}
export {};
//# sourceMappingURL=http-session.d.ts.map