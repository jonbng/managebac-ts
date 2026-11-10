const ERROR_BRAND = Symbol.for("managebac-js/ManageBacError");
export class ManageBacError extends Error {
    code;
    retryable;
    context;
    constructor(message, options = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = new.target.name;
        this.code = options.code ?? "MANAGEBAC_ERROR";
        this.retryable = options.retryable ?? false;
        this.context = Object.freeze({ ...options.context });
        Object.defineProperty(this, ERROR_BRAND, { value: true });
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            retryable: this.retryable,
            context: this.context,
        };
    }
}
export function isManageBacError(error) {
    if (error instanceof ManageBacError)
        return true;
    if (error === null || typeof error !== "object")
        return false;
    return error[ERROR_BRAND] === true;
}
export class ConfigurationError extends ManageBacError {
    constructor(message, options = {}) {
        super(message, { ...options, code: "INVALID_CONFIGURATION" });
    }
}
export class AuthenticationError extends ManageBacError {
    constructor(message = "ManageBac rejected the supplied credentials or session.", options = {}) {
        super(message, { ...options, code: "AUTHENTICATION_FAILED" });
    }
}
export class NetworkError extends ManageBacError {
    method;
    url;
    requestId;
    attempts;
    constructor(message, options = {}) {
        const context = {
            ...options.context,
            ...(options.method === undefined ? {} : { method: options.method }),
            ...(options.url === undefined ? {} : { url: options.url }),
            ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
            ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
        };
        super(message, { code: options.code ?? "NETWORK_ERROR", cause: options.cause, context, retryable: true });
        this.method = options.method;
        this.url = options.url;
        this.requestId = options.requestId;
        this.attempts = options.attempts;
    }
}
export class RequestTimeoutError extends NetworkError {
    constructor(message, options = {}) {
        super(message, { ...options, code: "REQUEST_TIMEOUT" });
    }
}
export class RequestAbortedError extends ManageBacError {
    method;
    url;
    requestId;
    attempts;
    constructor(message = "The request was aborted by the caller.", options = {}) {
        const context = {
            ...options.context,
            ...(options.method === undefined ? {} : { method: options.method }),
            ...(options.url === undefined ? {} : { url: options.url }),
            ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
            ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
        };
        super(message, { code: "REQUEST_ABORTED", cause: options.cause, context });
        this.method = options.method;
        this.url = options.url;
        this.requestId = options.requestId;
        this.attempts = options.attempts;
    }
}
export class UnexpectedResponseError extends ManageBacError {
    status;
    url;
    constructor(message, options = {}) {
        const context = {
            ...options.context,
            ...(options.status === undefined ? {} : { status: options.status }),
            ...(options.url === undefined ? {} : { url: options.url }),
        };
        const retryable = options.status === 408 || options.status === 425 || options.status === 429
            || (options.status !== undefined && options.status >= 500);
        super(message, { code: "UNEXPECTED_RESPONSE", cause: options.cause, context, retryable });
        this.status = options.status;
        this.url = options.url;
    }
}
export class ParserError extends ManageBacError {
    constructor(message, options = {}) {
        super(message, { ...options, code: "PARSER_ERROR" });
    }
}
export class DataIntegrityError extends ManageBacError {
    constructor(message, options = {}) {
        super(message, { ...options, code: "DATA_INTEGRITY_ERROR" });
    }
}
export class IncompleteDataError extends ManageBacError {
    constructor(message, options = {}) {
        super(message, { ...options, code: "INCOMPLETE_DATA" });
    }
}
export class CacheError extends ManageBacError {
    operation;
    constructor(message, options) {
        const context = { ...options.context, cacheOperation: options.operation };
        super(message, { code: "CACHE_ERROR", cause: options.cause, context });
        this.operation = options.operation;
    }
}
//# sourceMappingURL=errors.js.map