import type { ManageBacErrorCode } from "./errors.js";
declare const entityIdBrand: unique symbol;
declare const entityKeyBrand: unique symbol;
export type EntityKind = "task" | "class" | "unit" | "attachment" | "calendar-event" | "user" | "teacher";
export type EntityId<Kind extends EntityKind> = string & {
    readonly [entityIdBrand]: Kind;
};
export type EntityKey<Kind extends EntityKind> = string & {
    readonly [entityKeyBrand]: Kind;
};
export type ISODateTime = string & {
    readonly __isoDateTime: true;
};
export interface ManageBacSource {
    readonly provider: "managebac";
    readonly domain: string;
}
export interface ClassSummary {
    readonly kind: "class";
    readonly id: EntityId<"class">;
    readonly key: EntityKey<"class">;
    readonly source: ManageBacSource;
    readonly name: string | null;
    readonly url: string;
}
export interface ManageBacClass extends ClassSummary {
    readonly name: string;
    /** Raw, localized labels shown by ManageBac, such as course level. */
    readonly tags: readonly string[];
}
export interface TaskDueDate {
    /** The localized value displayed by ManageBac. */
    readonly label: string | null;
    /** Authoritative calendar timestamp normalized to UTC; null when no matching event is exposed. */
    readonly at: ISODateTime | null;
    /** Whether `at` represents an exact instant or an all-day calendar date. */
    readonly precision: "date-time" | "date" | null;
}
export interface Task {
    readonly kind: "task";
    /** ManageBac's source-native task ID. */
    readonly id: EntityId<"task">;
    /** A stable, domain-scoped identity suitable for databases and synchronization. */
    readonly key: EntityKey<"task">;
    readonly source: ManageBacSource;
    readonly title: string;
    readonly url: string;
    readonly class: ClassSummary;
    readonly due: TaskDueDate;
    readonly tags: readonly string[];
    readonly status: string | null;
}
export interface UnitSummary {
    readonly kind: "unit";
    readonly id: EntityId<"unit">;
    readonly key: EntityKey<"unit">;
    readonly source: ManageBacSource;
    readonly name: string;
    readonly url: string;
}
export interface Attachment {
    readonly kind: "attachment";
    readonly id: EntityId<"attachment">;
    readonly key: EntityKey<"attachment">;
    readonly source: ManageBacSource;
    readonly name: string;
    readonly sizeLabel: string | null;
    readonly url: string;
}
/** A teacher attribution. IDs remain null when ManageBac only exposes a display name. */
export interface TeacherSummary {
    readonly kind: "teacher";
    readonly id: EntityId<"teacher"> | null;
    readonly key: EntityKey<"teacher"> | null;
    readonly source: ManageBacSource;
    readonly name: string;
    readonly url: string | null;
}
export type SubmissionStatus = "submitted" | "not-submitted" | "not-required" | "unknown";
/** Student-facing submission state exposed on a task page. */
export interface TaskSubmissionDetails {
    readonly status: SubmissionStatus;
    /** Raw, localized status shown by ManageBac. */
    readonly statusLabel: string | null;
    /** Null when the page does not expose an authoritative submission timestamp. */
    readonly submittedAt: ISODateTime | null;
    readonly feedbackText: string | null;
}
export interface TaskDetails extends Task {
    readonly descriptionText: string | null;
    readonly teacher: TeacherSummary | null;
    readonly submission: TaskSubmissionDetails;
    readonly assessmentLabel: string | null;
    readonly unit: UnitSummary | null;
    readonly attachments: readonly Attachment[];
}
export type UnitStatus = "completed" | "current" | "upcoming" | "unknown";
export interface Unit extends UnitSummary {
    readonly class: ClassSummary;
    readonly status: UnitStatus;
    readonly tags: readonly string[];
    readonly schedule: Readonly<{
        startsLabel: string | null;
        durationLabel: string | null;
    }>;
    readonly counts: Readonly<{
        lessons: number | null;
        tasks: number | null;
    }>;
}
export interface TaskReference {
    readonly kind: "task";
    readonly id: EntityId<"task">;
    readonly key: EntityKey<"task">;
    readonly url: string;
    readonly classId: EntityId<"class">;
}
export interface CalendarEvent {
    readonly kind: "calendar-event";
    readonly id: EntityId<"calendar-event">;
    readonly key: EntityKey<"calendar-event">;
    readonly source: ManageBacSource;
    readonly title: string;
    readonly startsAt: ISODateTime;
    readonly endsAt: ISODateTime | null;
    readonly allDay: boolean;
    readonly descriptionText: string | null;
    readonly eventType: string;
    readonly categoryLabel: string | null;
    readonly color: string | null;
    readonly url: string | null;
    readonly relatedTask: TaskReference | null;
}
export type UserRole = "student" | "teacher" | "administrator" | "parent" | "unknown";
export interface UserProfile {
    readonly kind: "user";
    readonly id: EntityId<"user">;
    readonly key: EntityKey<"user">;
    readonly source: ManageBacSource;
    readonly name: string;
    readonly role: UserRole;
    readonly roleLabel: string | null;
    readonly programme: string | null;
    readonly url: string;
}
export interface CurrentUserOperations {
    get(options?: RequestOptions): Promise<UserProfile>;
}
export interface CollectionSnapshot<Item> {
    readonly items: readonly Item[];
    readonly fetchedAt: ISODateTime;
    readonly sourceUrl: string;
    readonly parserVersion: string;
    readonly completeness: "complete";
}
export interface CalendarSnapshot extends CollectionSnapshot<CalendarEvent> {
    readonly timezone: string;
}
export interface RequestOptions {
    signal?: AbortSignal | undefined;
    cacheMode?: "default" | "reload" | "no-store";
}
export type TaskView = "upcoming" | "past" | "overdue";
export interface TaskListOptions extends RequestOptions {
    view?: TaskView;
}
export interface TaskOperations {
    list(options?: TaskListOptions): Promise<readonly Task[]>;
    snapshot(options?: TaskListOptions): Promise<CollectionSnapshot<Task>>;
    listUpcoming(options?: RequestOptions): Promise<readonly Task[]>;
    snapshotUpcoming(options?: RequestOptions): Promise<CollectionSnapshot<Task>>;
}
export interface ClassTaskOperations {
    list(options?: TaskListOptions): Promise<readonly Task[]>;
    snapshot(options?: TaskListOptions): Promise<CollectionSnapshot<Task>>;
    listUpcoming(options?: RequestOptions): Promise<readonly Task[]>;
    snapshotUpcoming(options?: RequestOptions): Promise<CollectionSnapshot<Task>>;
    byId(id: EntityId<"task"> | string): TaskScope;
}
export interface TaskScope {
    readonly id: EntityId<"task">;
    readonly key: EntityKey<"task">;
    readonly url: string;
    get(options?: RequestOptions): Promise<TaskDetails>;
}
/** @deprecated Use Task. */
export type Homework = Task;
/** @deprecated Use TaskDetails. */
export type HomeworkDetails = TaskDetails;
/** @deprecated Use TaskDueDate. */
export type HomeworkDueDate = TaskDueDate;
/** @deprecated Use TaskOperations. */
export type HomeworkOperations = TaskOperations;
/** @deprecated Use ClassTaskOperations. */
export type ClassHomeworkOperations = ClassTaskOperations;
/** @deprecated Use TaskScope. */
export type HomeworkScope = TaskScope;
export interface ClassUnitOperations {
    list(options?: RequestOptions): Promise<readonly Unit[]>;
    snapshot(options?: RequestOptions): Promise<CollectionSnapshot<Unit>>;
}
export interface ClassScope {
    readonly id: EntityId<"class">;
    readonly key: EntityKey<"class">;
    readonly url: string;
    readonly tasks: ClassTaskOperations;
    /** @deprecated Use tasks. */
    readonly homework: ClassTaskOperations;
    readonly units: ClassUnitOperations;
}
export interface ClassOperations {
    list(options?: RequestOptions): Promise<readonly ManageBacClass[]>;
    snapshot(options?: RequestOptions): Promise<CollectionSnapshot<ManageBacClass>>;
    byId(id: EntityId<"class"> | string): ClassScope;
}
export type ManageBacEvent = Readonly<{
    type: "request:start";
    requestId: number;
    method: string;
    url: string;
    attempt: number;
}> | Readonly<{
    type: "request:end";
    requestId: number;
    method: string;
    url: string;
    status: number;
    durationMs: number;
}> | Readonly<{
    type: "request:error";
    requestId: number;
    method: string;
    url: string;
    attempt: number;
    errorName: string;
    errorCode: ManageBacErrorCode;
    durationMs: number;
}> | Readonly<{
    type: "request:retry";
    requestId: number;
    method: string;
    url: string;
    status: number | null;
    attempt: number;
    delayMs: number;
}> | Readonly<{
    type: "cache:hit" | "cache:miss" | "cache:set";
    key: string;
}> | Readonly<{
    type: "cache:error";
    key: string;
    operation: "get" | "set" | "delete" | "clear";
    errorName: string;
}> | Readonly<{
    type: "parse:end";
    resource: string;
    parserVersion: string;
    itemCount: number;
    durationMs: number;
}> | Readonly<{
    type: "parse:error";
    resource: string;
    parserVersion: string;
    errorCode: ManageBacErrorCode;
    durationMs: number;
}>;
export type ManageBacObserver = (event: ManageBacEvent) => void | Promise<void>;
export interface RetryOptions {
    /** Number of retries after the initial request. */
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    statuses?: readonly number[];
}
export interface RateLimitOptions {
    maxConcurrent?: number;
    minIntervalMs?: number;
}
export interface CacheStore {
    get(key: string): unknown | Promise<unknown>;
    set(key: string, value: unknown): void | Promise<void>;
    delete(key: string): void | Promise<void>;
    clear?(): void | Promise<void>;
}
export interface CacheOptions {
    /** Freshness duration. A value of zero disables reads and writes. */
    ttlMs: number;
    /** Maximum entries for the built-in memory cache. */
    maxEntries?: number;
    store?: CacheStore;
}
export interface CacheOperations {
    clear(): Promise<void>;
}
export interface CalendarQuery extends RequestOptions {
    start: Date | string;
    end: Date | string;
}
export interface CalendarOperations {
    list(options: CalendarQuery): Promise<readonly CalendarEvent[]>;
    snapshot(options: CalendarQuery): Promise<CalendarSnapshot>;
}
export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface SerializedCookieJar {
    readonly version?: string;
    readonly storeType?: string | null;
    readonly rejectPublicSuffixes?: boolean;
    readonly cookies: readonly Record<string, unknown>[];
}
export interface ManageBacClientOptions {
    domain: string;
    /**
     * Required unless `session` is set. A restored session does not need it.
     */
    username?: string;
    /**
     * Required unless `session` is set. Never persisted by this library.
     * Omit it when restoring a session so an expired jar cannot be silently re-posted.
     */
    password?: string;
    /** A jar previously returned by `ManageBacClient.exportSession()`. */
    session?: SerializedCookieJar;
    /** Ask ManageBac for a persistent 30-day session cookie. Defaults to `true`. */
    rememberMe?: boolean;
    timeoutMs?: number;
    userAgent?: string;
    fetch?: FetchImplementation;
    allowInsecure?: boolean;
    /** @deprecated Use `retry.maxRetries`. */
    maxRetries?: number;
    retry?: false | RetryOptions;
    rateLimit?: RateLimitOptions;
    cache?: false | CacheOptions;
    observer?: ManageBacObserver;
    now?: () => Date;
}
export {};
//# sourceMappingURL=types.d.ts.map