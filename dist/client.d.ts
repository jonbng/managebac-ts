import type { ClassOperations, CacheOperations, CalendarOperations, CurrentUserOperations, CollectionSnapshot, Homework, HomeworkOperations, ManageBacClientOptions, RequestOptions, TaskOperations } from "./types.js";
export declare class ManageBacClient {
    #private;
    readonly homework: HomeworkOperations;
    readonly tasks: TaskOperations;
    readonly classes: ClassOperations;
    readonly calendar: CalendarOperations;
    readonly me: CurrentUserOperations;
    readonly cache: CacheOperations;
    constructor(options: ManageBacClientOptions);
    get domain(): string;
    get authenticated(): boolean;
    login(options?: RequestOptions & {
        force?: boolean;
    }): Promise<void>;
    /** @deprecated Prefer `client.tasks.listUpcoming()`. */
    getUpcomingHomework(options?: RequestOptions): Promise<readonly Homework[]>;
    /** @deprecated Prefer `client.tasks.snapshotUpcoming()`. */
    getUpcomingHomeworkSnapshot(options?: RequestOptions): Promise<CollectionSnapshot<Homework>>;
}
//# sourceMappingURL=client.d.ts.map