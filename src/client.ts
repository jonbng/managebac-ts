import {
  AuthenticationError,
  CacheError,
  ConfigurationError,
  DataIntegrityError,
  IncompleteDataError,
  ParserError,
  UnexpectedResponseError,
} from "./errors.js";
import { MemoryCacheStore } from "./cache.js";
import { HttpSession } from "./internal/http-session.js";
import { createEntityKey } from "./internal/identity.js";
import { createEmitter } from "./internal/observability.js";
import { RateLimiter } from "./internal/rate-limiter.js";
import {
  assertAuthenticatedPage,
  CLASSES_PARSER_VERSION,
  CALENDAR_PARSER_VERSION,
  TASK_DETAILS_PARSER_VERSION,
  TASK_HINT_PARSER_VERSION,
  TASKS_PARSER_VERSION,
  UNITS_PARSER_VERSION,
  parseClassesPage,
  parseCalendarConfiguration,
  parseCalendarEvents,
  parseTaskDetails,
  parseTaskHint,
  parseTaskHintPath,
  parseLoginPage,
  parseTasksPage,
  parseUnitsPage,
  parseUserProfile,
  LOGIN_PARSER_VERSION,
  PROFILE_PARSER_VERSION,
} from "./internal/parsers.js";
import { normalizeDomain } from "./internal/url.js";
import type {
  ClassOperations,
  ClassScope,
  CacheOperations,
  CacheStore,
  CalendarEvent,
  CalendarOperations,
  CalendarQuery,
  CalendarSnapshot,
  CurrentUserOperations,
  CollectionSnapshot,
  EntityId,
  Homework,
  HomeworkDetails,
  HomeworkOperations,
  ISODateTime,
  ManageBacClass,
  ManageBacClientOptions,
  RequestOptions,
  SerializedCookieJar,
  TaskOperations,
  TaskListOptions,
  TaskView,
  Unit,
  UserProfile,
} from "./types.js";
import type { EmitEvent } from "./internal/observability.js";
import type { ManageBacErrorContext } from "./errors.js";

const DEFAULT_USER_AGENT = "managebac-js/0.1";
const CLASSES_PATH = "/student/classes/my";

interface Identified { readonly key: string }
interface ParsedPage<Item> { readonly items: readonly Item[]; readonly nextPath: string | null }
interface CollectionDefinition<Item extends Identified> {
  readonly initialPath: string;
  readonly parserVersion: string;
  readonly responseName: string;
  parse(html: string, baseUrl: string, pageUrl: string): ParsedPage<Item>;
  finalizeItems?(items: readonly Item[], signal: AbortSignal | undefined): Promise<readonly Item[]>;
}

interface CacheEnvelope {
  readonly expiresAt: number;
  readonly value: unknown;
}

const fingerprint = (value: unknown): string => JSON.stringify(value);
const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
const errorName = (error: unknown): string => error instanceof Error ? error.name : "UnknownError";
const isObject = (value: unknown): boolean =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isSerializedSession = (value: unknown): value is SerializedCookieJar =>
  isObject(value) && Array.isArray((value as { cookies?: unknown }).cookies);
function validateRequestOptions(options: unknown): asserts options is RequestOptions {
  if (!isObject(options)) throw new ConfigurationError("request options must be an object.");
  const input = options as Record<string, unknown>;
  const signal = input["signal"];
  if (signal !== undefined && (!isObject(signal)
    || typeof (signal as { aborted?: unknown }).aborted !== "boolean"
    || typeof (signal as { addEventListener?: unknown }).addEventListener !== "function")) {
    throw new ConfigurationError("signal must be an AbortSignal.");
  }
  const cacheMode = input["cacheMode"];
  if (cacheMode !== undefined && cacheMode !== "default" && cacheMode !== "reload" && cacheMode !== "no-store") {
    throw new ConfigurationError("cacheMode must be 'default', 'reload', or 'no-store'.");
  }
}

const normalizeTaskListOptions = (options: TaskListOptions | undefined): {
  readonly view: TaskView;
  readonly requestOptions: RequestOptions;
} => {
  const value = options === undefined ? {} : options;
  validateRequestOptions(value);
  const { view = "upcoming", ...requestOptions } = value;
  if (view !== "upcoming" && view !== "past" && view !== "overdue") {
    throw new ConfigurationError("task view must be 'upcoming', 'past', or 'overdue'.");
  }
  return { view, requestOptions };
};
const parseWithContext = <Value>(
  parse: () => Value,
  context: ManageBacErrorContext & { readonly resource: string; readonly parserVersion: string },
  emit: EmitEvent,
  startedAt: number,
): Value => {
  try {
    return parse();
  } catch (cause) {
    let failure: ParserError | DataIntegrityError;
    if (cause instanceof DataIntegrityError) {
      failure = new DataIntegrityError(cause.message, { cause, context });
    } else if (cause instanceof ParserError) {
      failure = new ParserError(cause.message, { cause, context });
    } else {
      failure = new ParserError("The ManageBac parser failed unexpectedly.", { cause, context });
    }
    emit({
      type: "parse:error",
      resource: context.resource,
      parserVersion: context.parserVersion,
      errorCode: failure.code,
      durationMs: performance.now() - startedAt,
    });
    throw failure;
  }
};

export class ManageBacClient {
  readonly #baseUrl: string;
  readonly #username: string;
  readonly #password: string;
  readonly #canLogin: boolean;
  readonly #rememberMe: boolean;
  readonly #session: HttpSession;
  readonly #now: () => Date;
  readonly #emit: EmitEvent;
  readonly #cacheStore: CacheStore | undefined;
  readonly #cacheTtlMs: number;
  readonly #cacheMaxEntries: number;
  readonly #cacheKeys = new Set<string>();
  readonly homework: HomeworkOperations;
  readonly tasks: TaskOperations;
  readonly classes: ClassOperations;
  readonly calendar: CalendarOperations;
  readonly me: CurrentUserOperations;
  readonly cache: CacheOperations;
  #authenticated = false;
  #loginPromise: Promise<void> | undefined;
  readonly #taskPromises = new Map<TaskView, Promise<CollectionSnapshot<Homework>>>();
  #classesPromise: Promise<CollectionSnapshot<ManageBacClass>> | undefined;
  readonly #unitPromises = new Map<string, Promise<CollectionSnapshot<Unit>>>();
  readonly #homeworkDetailsPromises = new Map<string, Promise<HomeworkDetails>>();
  readonly #calendarPromises = new Map<string, Promise<CalendarSnapshot>>();
  #calendarConfigurationPromise: Promise<ReturnType<typeof parseCalendarConfiguration>> | undefined;
  #taskCalendarEventsPromise: Promise<readonly CalendarEvent[]> | undefined;
  #profilePromise: Promise<UserProfile> | undefined;

  constructor(options: ManageBacClientOptions) {
    if (!options || typeof options !== "object") throw new ConfigurationError("Client options are required.");
    const hasSession = options.session !== undefined;
    if (hasSession && !isSerializedSession(options.session)) {
      throw new ConfigurationError("session must be a serialized cookie jar.");
    }
    if (options.username !== undefined && (typeof options.username !== "string" || options.username.trim() === "")) {
      throw new ConfigurationError("username must be a non-empty string.");
    }
    if (options.password !== undefined && (typeof options.password !== "string" || options.password === "")) {
      throw new ConfigurationError("password must be a non-empty string.");
    }
    if (!hasSession && (options.username === undefined || options.password === undefined)) {
      throw new ConfigurationError("username and password are required unless session is provided.");
    }
    if (options.rememberMe !== undefined && typeof options.rememberMe !== "boolean") {
      throw new ConfigurationError("rememberMe must be a boolean.");
    }
    if (options.allowInsecure !== undefined && typeof options.allowInsecure !== "boolean") {
      throw new ConfigurationError("allowInsecure must be a boolean.");
    }
    if (options.fetch !== undefined && typeof options.fetch !== "function") {
      throw new ConfigurationError("fetch must be a function.");
    }
    if (options.observer !== undefined && typeof options.observer !== "function") {
      throw new ConfigurationError("observer must be a function.");
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new ConfigurationError("now must be a function.");
    }
    if (options.userAgent !== undefined && (typeof options.userAgent !== "string" || options.userAgent.trim() === "")) {
      throw new ConfigurationError("userAgent must be a non-empty string.");
    }
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new ConfigurationError("timeoutMs must be a positive number.");
    }
    if (options.maxRetries !== undefined && (!Number.isInteger(options.maxRetries) || options.maxRetries < 0)) {
      throw new ConfigurationError("maxRetries must be a non-negative integer.");
    }
    if (options.maxRetries !== undefined && options.retry !== undefined) {
      throw new ConfigurationError("Use either maxRetries or retry, not both.");
    }
    if (options.retry !== undefined && options.retry !== false && !isObject(options.retry)) {
      throw new ConfigurationError("retry must be false or an options object.");
    }
    if (options.retry !== false) {
      for (const [name, value] of Object.entries({
        maxRetries: options.retry?.maxRetries,
        baseDelayMs: options.retry?.baseDelayMs,
        maxDelayMs: options.retry?.maxDelayMs,
      })) {
        const mustBeInteger = name === "maxRetries";
        if (value !== undefined && (!Number.isFinite(value) || value < 0 || (mustBeInteger && !Number.isInteger(value)))) {
          throw new ConfigurationError(`retry.${name} must be a non-negative number.`);
        }
      }
      if (options.retry?.statuses !== undefined && !Array.isArray(options.retry.statuses)) {
        throw new ConfigurationError("retry.statuses must be an array.");
      }
      if (options.retry?.statuses?.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
        throw new ConfigurationError("retry.statuses must contain valid HTTP status codes.");
      }
    }
    if (options.rateLimit !== undefined && !isObject(options.rateLimit)) {
      throw new ConfigurationError("rateLimit must be an options object.");
    }
    const maxConcurrent = options.rateLimit?.maxConcurrent ?? 4;
    const minIntervalMs = options.rateLimit?.minIntervalMs ?? 0;
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new ConfigurationError("rateLimit.maxConcurrent must be a positive integer.");
    }
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
      throw new ConfigurationError("rateLimit.minIntervalMs must be a non-negative number.");
    }
    if (options.cache !== undefined && options.cache !== false && !isObject(options.cache)) {
      throw new ConfigurationError("cache must be false or an options object.");
    }
    if (options.cache !== undefined && options.cache !== false
      && (!Number.isFinite(options.cache.ttlMs) || options.cache.ttlMs < 0)) {
      throw new ConfigurationError("cache.ttlMs must be a non-negative number.");
    }
    if (options.cache && options.cache.maxEntries !== undefined
      && (!Number.isInteger(options.cache.maxEntries) || options.cache.maxEntries < 1)) {
      throw new ConfigurationError("cache.maxEntries must be a positive integer.");
    }
    if (options.cache && options.cache.store !== undefined && (!isObject(options.cache.store)
      || typeof options.cache.store.get !== "function"
      || typeof options.cache.store.set !== "function"
      || typeof options.cache.store.delete !== "function")) {
      throw new ConfigurationError("cache.store must implement get, set, and delete.");
    }

    this.#baseUrl = normalizeDomain(options.domain, options.allowInsecure);
    this.#username = options.username ?? "";
    this.#password = options.password ?? "";
    this.#canLogin = options.password !== undefined;
    this.#rememberMe = options.rememberMe ?? true;
    if (hasSession) this.#authenticated = true;
    this.#now = options.now ?? (() => new Date());
    this.#emit = createEmitter(options.observer);
    this.#cacheTtlMs = options.cache ? options.cache.ttlMs : 0;
    this.#cacheMaxEntries = options.cache ? options.cache.maxEntries ?? 100 : 100;
    this.#cacheStore = options.cache && options.cache.ttlMs > 0
      ? options.cache.store ?? new MemoryCacheStore(
        options.cache.maxEntries === undefined ? {} : { maxEntries: options.cache.maxEntries },
      )
      : undefined;
    const retry = options.retry === undefined && options.maxRetries !== undefined
      ? { maxRetries: options.maxRetries }
      : options.retry;
    this.#session = new HttpSession({
      baseUrl: this.#baseUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      timeoutMs: options.timeoutMs ?? 15_000,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      ...(retry === undefined ? {} : { retry }),
      rateLimiter: new RateLimiter(maxConcurrent, minIntervalMs),
      emit: this.#emit,
      ...(options.session === undefined ? {} : { session: options.session }),
    });

    const taskOperations: TaskOperations = Object.freeze({
      list: async (options?: TaskListOptions) => {
        const { view, requestOptions } = normalizeTaskListOptions(options);
        return (await this.#getTasksSnapshot(view, requestOptions)).items;
      },
      snapshot: (options?: TaskListOptions) => {
        const { view, requestOptions } = normalizeTaskListOptions(options);
        return this.#getTasksSnapshot(view, requestOptions);
      },
      listUpcoming: (requestOptions = {}) => this.getUpcomingHomework(requestOptions),
      snapshotUpcoming: (requestOptions = {}) => this.getUpcomingHomeworkSnapshot(requestOptions),
    });
    this.tasks = taskOperations;
    this.homework = taskOperations;
    this.classes = Object.freeze({
      list: async (requestOptions = {}) => (await this.#getClassesSnapshot(requestOptions)).items,
      snapshot: (requestOptions = {}) => this.#getClassesSnapshot(requestOptions),
      byId: (id: EntityId<"class"> | string) => this.#createClassScope(id),
    });
    this.calendar = Object.freeze({
      list: async (query: CalendarQuery) => (await this.#getCalendarSnapshot(query)).items,
      snapshot: (query: CalendarQuery) => this.#getCalendarSnapshot(query),
    });
    this.me = Object.freeze({
      get: (requestOptions = {}) => this.#getCurrentUser(requestOptions),
    });
    this.cache = Object.freeze({
      clear: async () => {
        if (!this.#cacheStore) return;
        try {
          await Promise.all([...this.#cacheKeys].map((key) => this.#cacheStore?.delete(key)));
          this.#cacheKeys.clear();
        } catch (cause) {
          this.#emit({ type: "cache:error", key: "*", operation: "clear", errorName: errorName(cause) });
          throw new CacheError("Failed to clear the ManageBac cache.", { cause, operation: "clear" });
        }
      },
    });
  }

  get domain(): string { return this.#baseUrl; }
  get authenticated(): boolean { return this.#authenticated; }

  async exportSession(): Promise<SerializedCookieJar> {
    return this.#session.exportSession();
  }

  async login(options: RequestOptions & { force?: boolean } = {}): Promise<void> {
    validateRequestOptions(options);
    if (options.force !== undefined && typeof options.force !== "boolean") {
      throw new ConfigurationError("force must be a boolean.");
    }
    const { force = false, signal } = options;
    if (this.#loginPromise && !signal && this.#canLogin) return this.#loginPromise;
    if (this.#authenticated && !force) return;
    if (!this.#canLogin) {
      throw new AuthenticationError("ManageBac session expired. Sign in again.", {
        context: { operation: "login", resource: "login" },
      });
    }
    const attempt = this.#performLogin(signal);
    if (!signal) this.#loginPromise = attempt;
    try {
      await attempt;
      this.#authenticated = true;
    } catch (error) {
      this.#authenticated = false;
      throw error;
    } finally {
      if (this.#loginPromise === attempt) this.#loginPromise = undefined;
    }
  }

  async #performLogin(signal: AbortSignal | undefined): Promise<void> {
    const loginResponse = await this.#session.request("/login", signal ? { signal } : {});
    if (!loginResponse.ok) {
      throw new UnexpectedResponseError("ManageBac's login page returned an error.", {
        status: loginResponse.status, url: loginResponse.url,
      });
    }
    const loginHtml = await this.#session.readText(loginResponse);
    const loginPath = new URL(loginResponse.url).pathname;
    if (loginPath !== "/login") {
      assertAuthenticatedPage(loginHtml, loginPath, {
        operation: "login",
        resource: "login",
        parserVersion: LOGIN_PARSER_VERSION,
        url: loginResponse.url,
      });
      return;
    }
    const loginParseStartedAt = performance.now();
    const loginContext = {
      operation: "login",
      resource: "login",
      parserVersion: LOGIN_PARSER_VERSION,
      url: loginResponse.url,
    } as const;
    const { authenticityToken } = parseWithContext(
      () => parseLoginPage(loginHtml, loginContext),
      loginContext,
      this.#emit,
      loginParseStartedAt,
    );
    const response = await this.#session.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: this.#baseUrl,
        referer: `${this.#baseUrl}/login`,
      },
      body: new URLSearchParams({
        authenticity_token: authenticityToken,
        login: this.#username,
        password: this.#password,
        remember_me: this.#rememberMe ? "1" : "0",
        commit: "Sign in",
      }),
      ...(signal ? { signal } : {}),
    });
    const html = await this.#session.readText(response);
    assertAuthenticatedPage(html, new URL(response.url).pathname, {
      operation: "login",
      resource: "login",
      parserVersion: LOGIN_PARSER_VERSION,
      url: response.url,
      status: response.status,
    });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        throw new UnexpectedResponseError("ManageBac's sign-in endpoint returned an error.", {
          status: response.status,
          url: response.url,
        });
      }
      throw new AuthenticationError(`ManageBac sign-in failed with HTTP ${response.status}.`, {
        context: { status: response.status, url: response.url },
      });
    }
  }

  /** @deprecated Prefer `client.tasks.listUpcoming()`. */
  async getUpcomingHomework(options: RequestOptions = {}): Promise<readonly Homework[]> {
    return (await this.getUpcomingHomeworkSnapshot(options)).items;
  }

  /** @deprecated Prefer `client.tasks.snapshotUpcoming()`. */
  async getUpcomingHomeworkSnapshot(options: RequestOptions = {}): Promise<CollectionSnapshot<Homework>> {
    return this.#getTasksSnapshot("upcoming", options);
  }

  async #getTasksSnapshot(view: TaskView, options: RequestOptions): Promise<CollectionSnapshot<Homework>> {
    validateRequestOptions(options);
    if (options.signal || options.cacheMode === "reload" || options.cacheMode === "no-store") {
      return this.#fetchTasks(view, options);
    }
    const existing = this.#taskPromises.get(view);
    if (existing) return existing;
    const request = this.#fetchTasks(view, options);
    this.#taskPromises.set(view, request);
    try {
      return await request;
    } finally {
      if (this.#taskPromises.get(view) === request) this.#taskPromises.delete(view);
    }
  }

  #fetchTasks(view: TaskView, options: RequestOptions): Promise<CollectionSnapshot<Homework>> {
    const path = `/student/tasks_and_deadlines?view=${view}`;
    return this.#fetchCollection({
      initialPath: path,
      parserVersion: TASKS_PARSER_VERSION,
      responseName: `${view} tasks`,
      parse: (html, baseUrl, pageUrl) => parseTasksPage(html, baseUrl, pageUrl, view),
      finalizeItems: (items, signal) => this.#hydrateTaskDeadlines(items, signal),
    }, options);
  }

  async #getClassesSnapshot(options: RequestOptions): Promise<CollectionSnapshot<ManageBacClass>> {
    validateRequestOptions(options);
    if (options.signal || options.cacheMode === "reload" || options.cacheMode === "no-store") {
      return this.#fetchClasses(options);
    }
    if (this.#classesPromise) return this.#classesPromise;
    const request = this.#fetchClasses(options);
    this.#classesPromise = request;
    try {
      return await request;
    } finally {
      if (this.#classesPromise === request) this.#classesPromise = undefined;
    }
  }

  #fetchClasses(options: RequestOptions): Promise<CollectionSnapshot<ManageBacClass>> {
    return this.#fetchCollection({
      initialPath: CLASSES_PATH,
      parserVersion: CLASSES_PARSER_VERSION,
      responseName: "classes",
      parse: parseClassesPage,
    }, options);
  }

  #createClassScope(input: EntityId<"class"> | string): ClassScope {
    if (typeof input !== "string" || !/^\d+$/.test(input)) {
      throw new ConfigurationError("class ID must be a non-empty string containing only digits.");
    }
    const id = input as EntityId<"class">;
    const classTasks = Object.freeze({
      list: async (inputOptions?: TaskListOptions) => {
        const { view, requestOptions } = normalizeTaskListOptions(inputOptions);
        return (await this.#tasksForClass(id, view, requestOptions)).items;
      },
      snapshot: (inputOptions?: TaskListOptions) => {
        const { view, requestOptions } = normalizeTaskListOptions(inputOptions);
        return this.#tasksForClass(id, view, requestOptions);
      },
      listUpcoming: async (options = {}) => (await this.#homeworkForClass(id, options)).items,
      snapshotUpcoming: (options = {}) => this.#homeworkForClass(id, options),
      byId: (taskId: EntityId<"task"> | string) => this.#createHomeworkScope(id, taskId),
    });
    return Object.freeze({
      id,
      key: createEntityKey(this.#baseUrl, "class", id),
      url: new URL(`/student/classes/${id}`, this.#baseUrl).href,
      tasks: classTasks,
      homework: classTasks,
      units: Object.freeze({
        list: async (options = {}) => (await this.#getUnitsSnapshot(id, options)).items,
        snapshot: (options = {}) => this.#getUnitsSnapshot(id, options),
      }),
    });
  }

  #createHomeworkScope(
    classId: EntityId<"class">,
    input: EntityId<"task"> | string,
  ): import("./types.js").TaskScope {
    if (typeof input !== "string" || !/^\d+$/.test(input)) {
      throw new ConfigurationError("task ID must be a non-empty string containing only digits.");
    }
    const id = input as EntityId<"task">;
    const url = new URL(`/student/classes/${classId}/core_tasks/${id}`, this.#baseUrl).href;
    return Object.freeze({
      id,
      key: createEntityKey(this.#baseUrl, "task", id),
      url,
      get: (options = {}) => this.#getHomeworkDetails(classId, id, options),
    });
  }

  async #homeworkForClass(
    classId: EntityId<"class">,
    options: RequestOptions,
  ): Promise<CollectionSnapshot<Homework>> {
    const snapshot = await this.getUpcomingHomeworkSnapshot(options);
    return Object.freeze({
      ...snapshot,
      items: Object.freeze(snapshot.items.filter((item) => item.class.id === classId)),
    });
  }

  async #tasksForClass(
    classId: EntityId<"class">,
    view: TaskView,
    options: RequestOptions,
  ): Promise<CollectionSnapshot<Homework>> {
    const snapshot = await this.#getTasksSnapshot(view, options);
    return Object.freeze({
      ...snapshot,
      items: Object.freeze(snapshot.items.filter((item) => item.class.id === classId)),
    });
  }

  async #getUnitsSnapshot(
    classId: EntityId<"class">,
    options: RequestOptions,
  ): Promise<CollectionSnapshot<Unit>> {
    validateRequestOptions(options);
    const promiseKey = String(classId);
    if (options.signal || options.cacheMode === "reload" || options.cacheMode === "no-store") {
      return this.#fetchUnits(classId, options);
    }
    const existing = this.#unitPromises.get(promiseKey);
    if (existing) return existing;
    const request = this.#fetchUnits(classId, options);
    this.#unitPromises.set(promiseKey, request);
    try {
      return await request;
    } finally {
      if (this.#unitPromises.get(promiseKey) === request) this.#unitPromises.delete(promiseKey);
    }
  }

  #fetchUnits(classId: EntityId<"class">, options: RequestOptions): Promise<CollectionSnapshot<Unit>> {
    return this.#fetchCollection({
      initialPath: `/student/classes/${classId}/units`,
      parserVersion: UNITS_PARSER_VERSION,
      responseName: "class units",
      parse: (html, baseUrl, pageUrl) => parseUnitsPage(html, baseUrl, pageUrl, classId),
    }, options);
  }

  async #getHomeworkDetails(
    classId: EntityId<"class">,
    homeworkId: EntityId<"task">,
    options: RequestOptions,
  ): Promise<HomeworkDetails> {
    validateRequestOptions(options);
    const path = `/student/classes/${classId}/core_tasks/${homeworkId}`;
    const cacheKey = `managebac-js:${this.#baseUrl}:${TASK_DETAILS_PARSER_VERSION}:${path}`;
    if (options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      const cached = await this.#readCacheValue<HomeworkDetails>(cacheKey, (value) => {
        const item = value as Partial<HomeworkDetails>;
        return item?.kind === "task" && item.id === homeworkId && item.class?.id === classId
          && (item.due?.at === null || typeof item.due?.at === "string")
          && (item.due?.precision === null || item.due?.precision === "date" || item.due?.precision === "date-time")
          && (item.teacher === null || (typeof item.teacher === "object" && typeof item.teacher?.name === "string"))
          && typeof item.submission === "object" && typeof item.submission?.status === "string";
      });
      if (cached) return cached;
    }
    if (!options.signal && options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      const existing = this.#homeworkDetailsPromises.get(cacheKey);
      if (existing) return existing;
    }
    const request = this.#fetchHomeworkDetails(path, classId, homeworkId, options);
    if (!options.signal && options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      this.#homeworkDetailsPromises.set(cacheKey, request);
    }
    try {
      const item = await request;
      if (options.cacheMode !== "no-store") await this.#writeCache(cacheKey, item);
      return item;
    } finally {
      if (this.#homeworkDetailsPromises.get(cacheKey) === request) this.#homeworkDetailsPromises.delete(cacheKey);
    }
  }

  async #fetchHomeworkDetails(
    path: string,
    classId: EntityId<"class">,
    homeworkId: EntityId<"task">,
    options: RequestOptions,
  ): Promise<HomeworkDetails> {
    await this.login(options.signal ? { signal: options.signal } : {});
    const { response, html } = await this.#getAuthenticatedPage(path, options.signal);
    if (!response.ok) {
      throw new UnexpectedResponseError("ManageBac's task details page returned an error.", {
        status: response.status, url: response.url,
      });
    }
    if (new URL(response.url).pathname !== path) {
      throw new DataIntegrityError("ManageBac returned task details for an unexpected URL.");
    }
    const startedAt = performance.now();
    const item = parseWithContext(
      () => parseTaskDetails(html, this.#baseUrl, classId, homeworkId),
      { resource: "task details", parserVersion: TASK_DETAILS_PARSER_VERSION, url: response.url },
      this.#emit,
      startedAt,
    );
    this.#emit({
      type: "parse:end",
      resource: "task details",
      parserVersion: TASK_DETAILS_PARSER_VERSION,
      itemCount: 1,
      durationMs: performance.now() - startedAt,
    });

    const hintLinkStartedAt = performance.now();
    const hintPath = parseWithContext(
      () => parseTaskHintPath(html, this.#baseUrl, classId),
      { resource: "task hint link", parserVersion: TASK_DETAILS_PARSER_VERSION, url: response.url },
      this.#emit,
      hintLinkStartedAt,
    );
    const teacherRequest = hintPath === null
      ? Promise.resolve(null)
      : (async () => {
        const { response: hintResponse, html: hintHtml } = await this.#getAuthenticatedPage(hintPath, options.signal);
        if (!hintResponse.ok) {
          throw new UnexpectedResponseError("ManageBac's task hint endpoint returned an error.", {
            status: hintResponse.status,
            url: hintResponse.url,
          });
        }
        const hintStartedAt = performance.now();
        const teacher = parseWithContext(
          () => parseTaskHint(hintHtml, this.#baseUrl, classId, homeworkId),
          { resource: "task hint", parserVersion: TASK_HINT_PARSER_VERSION, url: hintResponse.url },
          this.#emit,
          hintStartedAt,
        );
        this.#emit({
          type: "parse:end",
          resource: "task hint",
          parserVersion: TASK_HINT_PARSER_VERSION,
          itemCount: teacher ? 1 : 0,
          durationMs: performance.now() - hintStartedAt,
        });
        return teacher;
      })();
    const [datedItems, teacher] = await Promise.all([
      this.#hydrateTaskDeadlines([item], options.signal),
      teacherRequest,
    ]);
    const datedItem = datedItems[0];
    if (!datedItem) {
      throw new DataIntegrityError("Task deadline hydration unexpectedly removed the task.", {
        context: { resource: "task details", parserVersion: TASK_DETAILS_PARSER_VERSION, url: response.url },
      });
    }
    return Object.freeze({ ...datedItem, teacher });
  }

  async #getCalendarSnapshot(query: CalendarQuery): Promise<CalendarSnapshot> {
    if (!isObject(query)) throw new ConfigurationError("calendar query must be an object.");
    validateRequestOptions(query);
    const start = this.#normalizeCalendarBoundary(query.start, "start");
    const end = this.#normalizeCalendarBoundary(query.end, "end");
    if (Date.parse(start) >= Date.parse(end)) throw new ConfigurationError("calendar start must be before end.");
    const promiseKey = `${start}\0${end}`;
    if (query.signal || query.cacheMode === "reload" || query.cacheMode === "no-store") {
      return this.#fetchCalendar(start, end, query);
    }
    const existing = this.#calendarPromises.get(promiseKey);
    if (existing) return existing;
    const request = this.#fetchCalendar(start, end, query);
    this.#calendarPromises.set(promiseKey, request);
    try {
      return await request;
    } finally {
      if (this.#calendarPromises.get(promiseKey) === request) this.#calendarPromises.delete(promiseKey);
    }
  }

  #normalizeCalendarBoundary(value: Date | string, name: "start" | "end"): string {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new ConfigurationError(`calendar ${name} is invalid.`);
      return value.toISOString();
    }
    if (typeof value !== "string" || value.trim() === "" || Number.isNaN(Date.parse(value))) {
      throw new ConfigurationError(`calendar ${name} must be a valid date or date-time string.`);
    }
    return value;
  }

  async #getCalendarConfiguration(signal: AbortSignal | undefined) {
    if (this.#calendarConfigurationPromise && !signal) return this.#calendarConfigurationPromise;
    const request = (async () => {
      await this.login(signal ? { signal } : {});
      const { response, html } = await this.#getAuthenticatedPage("/student/calendar", signal);
      if (!response.ok) {
        throw new UnexpectedResponseError("ManageBac's calendar page returned an error.", {
          status: response.status, url: response.url,
        });
      }
      const startedAt = performance.now();
      return parseWithContext(
        () => parseCalendarConfiguration(html),
        { resource: "calendar configuration", parserVersion: CALENDAR_PARSER_VERSION, url: response.url },
        this.#emit,
        startedAt,
      );
    })();
    if (!signal) this.#calendarConfigurationPromise = request;
    try {
      return await request;
    } catch (error) {
      if (this.#calendarConfigurationPromise === request) this.#calendarConfigurationPromise = undefined;
      throw error;
    }
  }

  async #fetchCalendar(start: string, end: string, options: RequestOptions): Promise<CalendarSnapshot> {
    const cacheKey = `managebac-js:${this.#baseUrl}:${CALENDAR_PARSER_VERSION}:${start}:${end}`;
    if (options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      const cached = await this.#readCacheValue<CalendarSnapshot>(cacheKey, (value) => {
        const snapshot = value as Partial<CalendarSnapshot>;
        return Array.isArray(snapshot?.items) && snapshot.parserVersion === CALENDAR_PARSER_VERSION
          && snapshot.completeness === "complete" && typeof snapshot.timezone === "string";
      });
      if (cached) return cached;
    }
    const configuration = await this.#getCalendarConfiguration(options.signal);
    const url = new URL(configuration.eventsPath, this.#baseUrl);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    const items = await this.#fetchCalendarEvents(url.href, options.signal);
    const fetchedAt = this.#currentDate();
    const snapshot: CalendarSnapshot = Object.freeze({
      items,
      fetchedAt: fetchedAt.toISOString() as ISODateTime,
      sourceUrl: url.href,
      parserVersion: CALENDAR_PARSER_VERSION,
      completeness: "complete",
      timezone: configuration.timezone,
    });
    if (options.cacheMode !== "no-store") await this.#writeCache(cacheKey, snapshot);
    return snapshot;
  }

  async #getTaskCalendarEvents(signal: AbortSignal | undefined): Promise<readonly CalendarEvent[]> {
    if (this.#taskCalendarEventsPromise && !signal) return this.#taskCalendarEventsPromise;
    const request = (async () => {
      const configuration = await this.#getCalendarConfiguration(signal);
      return this.#fetchCalendarEvents(new URL(configuration.eventsPath, this.#baseUrl).href, signal);
    })();
    if (!signal) this.#taskCalendarEventsPromise = request;
    try {
      return await request;
    } finally {
      if (this.#taskCalendarEventsPromise === request) this.#taskCalendarEventsPromise = undefined;
    }
  }

  async #fetchCalendarEvents(url: string, signal: AbortSignal | undefined): Promise<readonly CalendarEvent[]> {
    const { response, html: json } = await this.#getAuthenticatedPage(url, signal);
    if (!response.ok) {
      throw new UnexpectedResponseError("ManageBac's calendar events endpoint returned an error.", {
        status: response.status, url: response.url,
      });
    }
    const startedAt = performance.now();
    const items = parseWithContext(
      () => parseCalendarEvents(json, this.#baseUrl),
      { resource: "calendar events", parserVersion: CALENDAR_PARSER_VERSION, url: response.url },
      this.#emit,
      startedAt,
    );
    this.#emit({
      type: "parse:end",
      resource: "calendar events",
      parserVersion: CALENDAR_PARSER_VERSION,
      itemCount: items.length,
      durationMs: performance.now() - startedAt,
    });
    return items;
  }

  async #hydrateTaskDeadlines<Item extends Homework>(
    tasks: readonly Item[],
    signal: AbortSignal | undefined,
  ): Promise<readonly Item[]> {
    if (tasks.length === 0) return tasks;
    const events = await this.#getTaskCalendarEvents(signal);
    const deadlines = new Map<string, Readonly<{ at: ISODateTime; precision: "date" | "date-time" }>>();
    for (const event of events) {
      if (!event.relatedTask) continue;
      const taskKey = `${event.relatedTask.classId}\0${event.relatedTask.id}`;
      const previous = deadlines.get(taskKey);
      const deadline = Object.freeze({
        at: event.startsAt,
        precision: event.allDay ? "date" as const : "date-time" as const,
      });
      if (previous !== undefined && (previous.at !== deadline.at || previous.precision !== deadline.precision)) {
        throw new DataIntegrityError(`ManageBac returned conflicting deadlines for ${event.relatedTask.key}.`, {
          context: {
            resource: "task deadlines",
            parserVersion: CALENDAR_PARSER_VERSION,
            ...(event.url === null ? {} : { url: event.url }),
          },
        });
      }
      deadlines.set(taskKey, deadline);
    }
    return Object.freeze(tasks.map<Item>((task) => Object.freeze({
      ...task,
      due: Object.freeze({ ...task.due, ...(deadlines.get(`${task.class.id}\0${task.id}`) ?? {
        at: null,
        precision: null,
      }) }),
    }) as Item));
  }

  async #getCurrentUser(options: RequestOptions): Promise<UserProfile> {
    validateRequestOptions(options);
    const path = "/student/profile";
    const cacheKey = `managebac-js:${this.#baseUrl}:${PROFILE_PARSER_VERSION}:${path}`;
    if (options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      const cached = await this.#readCacheValue<UserProfile>(cacheKey, (value) => {
        const profile = value as Partial<UserProfile>;
        return profile?.kind === "user" && typeof profile.id === "string" && typeof profile.name === "string";
      });
      if (cached) return cached;
    }
    if (!options.signal && options.cacheMode !== "reload" && options.cacheMode !== "no-store" && this.#profilePromise) {
      return this.#profilePromise;
    }
    const request = (async () => {
      await this.login(options.signal ? { signal: options.signal } : {});
      const { response, html } = await this.#getAuthenticatedPage(path, options.signal);
      if (!response.ok) {
        throw new UnexpectedResponseError("ManageBac's profile page returned an error.", {
          status: response.status, url: response.url,
        });
      }
      const startedAt = performance.now();
      const profile = parseWithContext(
        () => parseUserProfile(html, this.#baseUrl),
        { resource: "current user", parserVersion: PROFILE_PARSER_VERSION, url: response.url },
        this.#emit,
        startedAt,
      );
      this.#emit({
        type: "parse:end",
        resource: "current user",
        parserVersion: PROFILE_PARSER_VERSION,
        itemCount: 1,
        durationMs: performance.now() - startedAt,
      });
      if (options.cacheMode !== "no-store") await this.#writeCache(cacheKey, profile);
      return profile;
    })();
    if (!options.signal && options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      this.#profilePromise = request;
    }
    try {
      return await request;
    } finally {
      if (this.#profilePromise === request) this.#profilePromise = undefined;
    }
  }

  async #fetchCollection<Item extends Identified>(
    definition: CollectionDefinition<Item>,
    options: RequestOptions,
  ): Promise<CollectionSnapshot<Item>> {
    const cacheKey = `managebac-js:${this.#baseUrl}:${definition.parserVersion}:${definition.initialPath}`;
    if (options.cacheMode !== "reload" && options.cacheMode !== "no-store") {
      const cached = await this.#readCacheValue<CollectionSnapshot<Item>>(cacheKey, (value) => {
        const snapshot = value as Partial<CollectionSnapshot<Item>>;
        return Array.isArray(snapshot?.items)
          && snapshot.parserVersion === definition.parserVersion
          && snapshot.completeness === "complete";
      });
      if (cached) return cached;
    }
    const signal = options.signal;
    await this.login(signal ? { signal } : {});
    const items = new Map<string, Item>();
    const seenPages = new Set<string>();
    let path: string | null = definition.initialPath;

    while (path !== null) {
      const pageUrl = new URL(path, this.#baseUrl).href;
      if (seenPages.has(pageUrl)) {
        throw new IncompleteDataError("ManageBac returned a pagination loop.", {
          context: { resource: definition.responseName, parserVersion: definition.parserVersion, url: pageUrl },
        });
      }
      if (seenPages.size >= 100) {
        throw new IncompleteDataError("ManageBac returned more than 100 pages.", {
          context: { resource: definition.responseName, parserVersion: definition.parserVersion, url: pageUrl },
        });
      }
      seenPages.add(pageUrl);
      const { response, html } = await this.#getAuthenticatedPage(path, signal);
      if (!response.ok) {
        throw new UnexpectedResponseError(`ManageBac's ${definition.responseName} page returned an error.`, {
          status: response.status, url: response.url,
        });
      }
      const parseStartedAt = performance.now();
      const parsed = parseWithContext(
        () => definition.parse(html, this.#baseUrl, response.url),
        { resource: definition.responseName, parserVersion: definition.parserVersion, url: response.url },
        this.#emit,
        parseStartedAt,
      );
      this.#emit({
        type: "parse:end",
        resource: definition.responseName,
        parserVersion: definition.parserVersion,
        itemCount: parsed.items.length,
        durationMs: performance.now() - parseStartedAt,
      });
      for (const item of parsed.items) {
        const previous = items.get(item.key);
        if (previous && fingerprint(previous) !== fingerprint(item)) {
          throw new DataIntegrityError(`ManageBac returned conflicting records for ${item.key}.`, {
            context: { resource: definition.responseName, parserVersion: definition.parserVersion, url: response.url },
          });
        }
        if (!previous) items.set(item.key, item);
      }
      path = parsed.nextPath;
    }

    const finalizedItems = definition.finalizeItems
      ? await definition.finalizeItems(Object.freeze([...items.values()]), signal)
      : Object.freeze([...items.values()]);
    const fetchedAt = this.#currentDate();
    const snapshot: CollectionSnapshot<Item> = Object.freeze({
      items: Object.freeze([...finalizedItems]),
      fetchedAt: fetchedAt.toISOString() as ISODateTime,
      sourceUrl: new URL(definition.initialPath, this.#baseUrl).href,
      parserVersion: definition.parserVersion,
      completeness: "complete",
    });
    if (options.cacheMode !== "no-store") await this.#writeCache(cacheKey, snapshot);
    return snapshot;
  }

  async #readCacheValue<Value>(key: string, validate: (value: unknown) => boolean): Promise<Value | undefined> {
    if (!this.#cacheStore || this.#cacheTtlMs === 0) return undefined;
    let entry: CacheEnvelope | undefined;
    try {
      entry = await this.#cacheStore.get(key) as CacheEnvelope | undefined;
    } catch (error) {
      this.#emit({ type: "cache:error", key, operation: "get", errorName: errorName(error) });
      return undefined;
    }
    if (!entry || typeof entry !== "object" || typeof entry.expiresAt !== "number"
      || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= this.#currentDate().getTime()) {
      this.#emit({ type: "cache:miss", key });
      if (entry) {
        try {
          await this.#cacheStore.delete(key);
        } catch (error) {
          this.#emit({ type: "cache:error", key, operation: "delete", errorName: errorName(error) });
        }
      }
      return undefined;
    }
    if (!validate(entry.value)) {
      this.#emit({ type: "cache:miss", key });
      try {
        await this.#cacheStore.delete(key);
      } catch (error) {
        this.#emit({ type: "cache:error", key, operation: "delete", errorName: errorName(error) });
      }
      return undefined;
    }
    this.#emit({ type: "cache:hit", key });
    this.#cacheKeys.delete(key);
    this.#cacheKeys.add(key);
    try {
      return deepFreeze(structuredClone(entry.value)) as Value;
    } catch (error) {
      this.#emit({ type: "cache:error", key, operation: "get", errorName: errorName(error) });
      try {
        await this.#cacheStore.delete(key);
      } catch (deleteError) {
        this.#emit({ type: "cache:error", key, operation: "delete", errorName: errorName(deleteError) });
      }
      return undefined;
    }
  }

  async #writeCache(key: string, value: unknown): Promise<void> {
    if (!this.#cacheStore || this.#cacheTtlMs === 0) return;
    try {
      if (!this.#cacheKeys.has(key) && this.#cacheKeys.size >= this.#cacheMaxEntries) {
        const oldest = this.#cacheKeys.values().next().value;
        if (oldest !== undefined) {
          await this.#cacheStore.delete(oldest);
          this.#cacheKeys.delete(oldest);
        }
      }
      await this.#cacheStore.set(key, Object.freeze({
        expiresAt: this.#currentDate().getTime() + this.#cacheTtlMs,
        value,
      } satisfies CacheEnvelope));
      this.#cacheKeys.delete(key);
      this.#cacheKeys.add(key);
      this.#emit({ type: "cache:set", key });
    } catch (error) {
      this.#emit({ type: "cache:error", key, operation: "set", errorName: errorName(error) });
    }
  }

  async #getAuthenticatedPage(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<{ response: Response; html: string }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.#session.request(path, signal ? { signal } : {});
      const html = await this.#session.readText(response);
      try {
        assertAuthenticatedPage(html, new URL(response.url).pathname, {
          operation: "authenticate",
          url: response.url,
          status: response.status,
        });
        return { response, html };
      } catch (error) {
        if (!(error instanceof AuthenticationError) || attempt === 1) throw error;
        this.#authenticated = false;
        await this.login({ force: true, ...(signal ? { signal } : {}) });
      }
    }
    throw new AuthenticationError();
  }

  #currentDate(): Date {
    let value: unknown;
    try {
      value = this.#now();
    } catch (cause) {
      throw new ConfigurationError("The configured clock threw an error.", { cause });
    }
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new ConfigurationError("The configured clock must return a valid Date.");
    }
    return value;
  }
}
