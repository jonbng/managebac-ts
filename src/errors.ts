export type ManageBacErrorCode =
  | "MANAGEBAC_ERROR"
  | "INVALID_CONFIGURATION"
  | "AUTHENTICATION_FAILED"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "NETWORK_ERROR"
  | "UNEXPECTED_RESPONSE"
  | "PARSER_ERROR"
  | "DATA_INTEGRITY_ERROR"
  | "INCOMPLETE_DATA"
  | "CACHE_ERROR";

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

const ERROR_BRAND = Symbol.for("managebac-js/ManageBacError");

export class ManageBacError extends Error {
  readonly code: ManageBacErrorCode;
  readonly retryable: boolean;
  readonly context: Readonly<ManageBacErrorContext>;

  constructor(message: string, options: BaseErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? "MANAGEBAC_ERROR";
    this.retryable = options.retryable ?? false;
    this.context = Object.freeze({ ...options.context });
    Object.defineProperty(this, ERROR_BRAND, { value: true });
  }

  toJSON(): Readonly<{
    name: string;
    code: ManageBacErrorCode;
    message: string;
    retryable: boolean;
    context: Readonly<ManageBacErrorContext>;
  }> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

export function isManageBacError(error: unknown): error is ManageBacError {
  if (error instanceof ManageBacError) return true;
  if (error === null || typeof error !== "object") return false;
  return (error as Record<PropertyKey, unknown>)[ERROR_BRAND] === true;
}

export class ConfigurationError extends ManageBacError {
  constructor(message: string, options: ErrorDetails = {}) {
    super(message, { ...options, code: "INVALID_CONFIGURATION" });
  }
}

export class AuthenticationError extends ManageBacError {
  constructor(message = "ManageBac rejected the supplied credentials or session.", options: ErrorDetails = {}) {
    super(message, { ...options, code: "AUTHENTICATION_FAILED" });
  }
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

export class NetworkError extends ManageBacError {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly requestId: number | undefined;
  readonly attempts: number | undefined;

  constructor(message: string, options: NetworkErrorDetails = {}) {
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
  constructor(message: string, options: TransportErrorDetails = {}) {
    super(message, { ...options, code: "REQUEST_TIMEOUT" });
  }
}

export class RequestAbortedError extends ManageBacError {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly requestId: number | undefined;
  readonly attempts: number | undefined;

  constructor(message = "The request was aborted by the caller.", options: TransportErrorDetails = {}) {
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
  readonly status: number | undefined;
  readonly url: string | undefined;

  constructor(message: string, options: ErrorDetails & { status?: number; url?: string } = {}) {
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
  constructor(message: string, options: ErrorDetails = {}) {
    super(message, { ...options, code: "PARSER_ERROR" });
  }
}

export class DataIntegrityError extends ManageBacError {
  constructor(message: string, options: ErrorDetails = {}) {
    super(message, { ...options, code: "DATA_INTEGRITY_ERROR" });
  }
}

export class IncompleteDataError extends ManageBacError {
  constructor(message: string, options: ErrorDetails = {}) {
    super(message, { ...options, code: "INCOMPLETE_DATA" });
  }
}

export class CacheError extends ManageBacError {
  readonly operation: "get" | "set" | "delete" | "clear";

  constructor(message: string, options: ErrorDetails & { operation: "get" | "set" | "delete" | "clear" }) {
    const context = { ...options.context, cacheOperation: options.operation };
    super(message, { code: "CACHE_ERROR", cause: options.cause, context });
    this.operation = options.operation;
  }
}
