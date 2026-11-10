import { describe, expect, test } from "bun:test";
import {
  CacheError,
  ConfigurationError,
  ManageBacClient,
  NetworkError,
  ParserError,
  RequestAbortedError,
  RequestTimeoutError,
  UnexpectedResponseError,
  isManageBacError,
} from "../src/index.js";
import type { FetchImplementation, ManageBacClientOptions } from "../src/index.js";

const options = (fetch: FetchImplementation): ManageBacClientOptions => ({
  domain: "school.managebac.com",
  username: "student",
  password: "password",
  fetch,
  retry: false,
});

function response(body: string, url: string, status = 200, headers?: HeadersInit): Response {
  const value = new Response(body, { status, ...(headers === undefined ? {} : { headers }) });
  Object.defineProperty(value, "url", { value: url });
  return value;
}

const authenticatedFetch = (page: string): FetchImplementation => async (input) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname === "/login") {
    return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', url.href);
  }
  if (url.pathname === "/sessions") {
    return response("", url.href, 302, { location: "/student/calendar" });
  }
  if (url.pathname === "/student/calendar") return response("<main>Calendar</main>", url.href);
  return response(page, url.href);
};

describe("public error contract", () => {
  test("exposes stable codes, retryability, safe context, and JSON", () => {
    const cause = new TypeError("socket closed");
    const error = new NetworkError("Request failed.", {
      cause,
      method: "GET",
      url: "https://school.managebac.com/student/calendar",
      requestId: 7,
      attempts: 3,
    });

    expect(isManageBacError(error)).toBe(true);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({
      method: "GET",
      url: "https://school.managebac.com/student/calendar",
      requestId: 7,
      attempts: 3,
    });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "NetworkError",
      code: "NETWORK_ERROR",
      message: "Request failed.",
      retryable: true,
      context: error.context,
    });
  });

  test("classifies caller cancellation separately from network failure", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const client = new ManageBacClient(options(async () => {
      throw new Error("fetch should not complete");
    }));

    const error = await client.login({ signal: controller.signal }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RequestAbortedError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as RequestAbortedError).code).toBe("REQUEST_ABORTED");
    expect((error as RequestAbortedError).retryable).toBe(false);
  });

  test("classifies request deadlines as retryable timeouts", async () => {
    const fetch: FetchImplementation = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    const client = new ManageBacClient({ ...options(fetch), timeoutMs: 5 });

    const error = await client.login().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as RequestTimeoutError).code).toBe("REQUEST_TIMEOUT");
    expect((error as RequestTimeoutError).retryable).toBe(true);
    expect((error as RequestTimeoutError).attempts).toBe(1);
  });

  test("wraps transport failures and preserves their cause", async () => {
    const cause = new TypeError("DNS lookup failed");
    const client = new ManageBacClient(options(async () => { throw cause; }));

    const error = await client.login().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBe(cause);
    expect((error as NetworkError).context).toMatchObject({
      method: "GET",
      url: "https://school.managebac.com/login",
      attempts: 1,
    });
  });

  test("marks transient HTTP statuses as retryable", () => {
    expect(new UnexpectedResponseError("busy", { status: 503 }).retryable).toBe(true);
    expect(new UnexpectedResponseError("missing", { status: 404 }).retryable).toBe(false);
  });

  test("reports invalid runtime options as configuration errors", () => {
    expect(() => new ManageBacClient({
      ...options(globalThis.fetch),
      fetch: "not-fetch",
    } as unknown as ManageBacClientOptions)).toThrow(ConfigurationError);
  });

  test("adds parser version and source context without retaining response bodies", async () => {
    const secretBody = "not a tasks page SECRET_RESPONSE_VALUE";
    const client = new ManageBacClient(options(authenticatedFetch(secretBody)));

    const error = await client.tasks.listUpcoming().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ParserError);
    expect((error as ParserError).context).toMatchObject({
      resource: "upcoming tasks",
      parserVersion: "tasks-and-deadlines/v2",
      url: "https://school.managebac.com/student/tasks_and_deadlines?view=upcoming",
    });
    expect(JSON.stringify(error)).not.toContain("SECRET_RESPONSE_VALUE");
  });

  test("wraps an explicit cache-clear failure", async () => {
    const client = new ManageBacClient({
      ...options(authenticatedFetch(`
        <body class="controller-student-tasks_and_deadlines" data-path="student/tasks_and_deadlines/index">
          <a class="active" href="/student/tasks_and_deadlines?view=upcoming">Upcoming</a>
          <main>No upcoming tasks</main>
        </body>
      `)),
      cache: {
        ttlMs: 60_000,
        store: {
          get: () => undefined,
          set: () => undefined,
          delete: () => { throw new Error("cache offline"); },
        },
      },
    });
    await client.tasks.listUpcoming();

    const error = await client.cache.clear().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CacheError);
    expect((error as CacheError).code).toBe("CACHE_ERROR");
    expect((error as CacheError).operation).toBe("clear");
  });
});
