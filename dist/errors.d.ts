export type ManageBacErrorCode = "MANAGEBAC_ERROR" | "INVALID_CONFIGURATION" | "AUTHENTICATION_FAILED" | "REQUEST_ABORTED" | "REQUEST_TIMEOUT" | "NETWORK_ERROR" | "UNEXPECTED_RESPONSE" | "PARSER_ERROR" | "DATA_INTEGRITY_ERROR" | "INCOMPLETE_DATA" | "CACHE_ERROR";
/** Safe diagnostic metadata. It never contains headers, bodies, cookies, or credentials. */
export interface ManageBacErrorContext {
    readonly operation?: string;
    readonly method?: string;
    readonly url?: string;
    readonly status?: number;
    readonly requestId?: number;
    readonly attempts?: number;
    readonly resource?: string;
    readonly parserVersion?: string;
    readonly cacheOperation?: "get" | "set" | "delete" | "clear";
}
interface ErrorDetails {
    readonly cause?: unknown;
    readonly context?: ManageBacErrorContext;
}
interface BaseErrorOptions extends ErrorDetails {
    readonly code?: ManageBacErrorCode;
    readonly retryable?: boolean;
}
export declare class ManageBacError extends Error {
    readonly code: ManageBacErrorCode;
    readonly retryable: boolean;
    readonly context: Readonly<ManageBacErrorContext>;
    constructor(message: string, options?: BaseErrorOptions);
    toJSON(): Readonly<{
        name: string;
        code: ManageBacErrorCode;
        message: string;
        retryable: boolean;
        context: Readonly<ManageBacErrorContext>;
    }>;
}
export declare function isManageBacError(error: unknown): error is ManageBacError;
export declare class ConfigurationError extends ManageBacError {
    constructor(message: string, options?: ErrorDetails);
}
export declare class AuthenticationError extends ManageBacError {
    constructor(message?: string, options?: ErrorDetails);
}
interface TransportErrorDetails extends ErrorDetails {
    readonly method?: string;
    readonly url?: string;
    readonly requestId?: number;
    readonly attempts?: number;
}
interface NetworkErrorDetails extends TransportErrorDetails {
    readonly code?: "NETWORK_ERROR" | "REQUEST_TIMEOUT";
}
export declare class NetworkError extends ManageBacError {
    readonly method: string | undefined;
    readonly url: string | undefined;
    readonly requestId: number | undefined;
    readonly attempts: number | undefined;
    constructor(message: string, options?: NetworkErrorDetails);
}
export declare class RequestTimeoutError extends NetworkError {
    constructor(message: string, options?: TransportErrorDetails);
}
export declare class RequestAbortedError extends ManageBacError {
    readonly method: string | undefined;
    readonly url: string | undefined;
    readonly requestId: number | undefined;
    readonly attempts: number | undefined;
    constructor(message?: string, options?: TransportErrorDetails);
}
export declare class UnexpectedResponseError extends ManageBacError {
    readonly status: number | undefined;
    readonly url: string | undefined;
    constructor(message: string, options?: ErrorDetails & {
        status?: number;
        url?: string;
    });
}
export declare class ParserError extends ManageBacError {
    constructor(message: string, options?: ErrorDetails);
}
export declare class DataIntegrityError extends ManageBacError {
    constructor(message: string, options?: ErrorDetails);
}
export declare class IncompleteDataError extends ManageBacError {
    constructor(message: string, options?: ErrorDetails);
}
export declare class CacheError extends ManageBacError {
    readonly operation: "get" | "set" | "delete" | "clear";
    constructor(message: string, options: ErrorDetails & {
        operation: "get" | "set" | "delete" | "clear";
    });
}
export {};
//# sourceMappingURL=errors.d.ts.map