import type { ManageBacErrorContext } from "../errors.js";
import type { CalendarEvent, Homework, HomeworkDetails, ManageBacClass, TaskView, TeacherSummary, Unit, UserProfile } from "../types.js";
import { parseEntityId } from "./identity.js";
export declare const TASKS_PARSER_VERSION = "tasks-and-deadlines/v2";
export declare const CLASSES_PARSER_VERSION = "student-classes/v1";
export declare const UNITS_PARSER_VERSION = "class-units/v1";
export declare const TASK_DETAILS_PARSER_VERSION = "core-task/v3";
export declare const TASK_HINT_PARSER_VERSION = "task-hint/v1";
export declare const CALENDAR_PARSER_VERSION = "student-calendar/v1";
export declare const PROFILE_PARSER_VERSION = "student-profile/v1";
export declare const LOGIN_PARSER_VERSION = "login/v1";
export interface ParsedTaskPage {
    readonly items: readonly Homework[];
    readonly nextPath: string | null;
}
export interface ParsedClassesPage {
    readonly items: readonly ManageBacClass[];
    readonly nextPath: string | null;
}
export interface ParsedUnitsPage {
    readonly items: readonly Unit[];
    readonly nextPath: string | null;
}
export interface CalendarConfiguration {
    readonly timezone: string;
    readonly eventsPath: string;
}
export declare function parseLoginPage(html: string, context?: ManageBacErrorContext): {
    authenticityToken: string;
};
export declare function assertAuthenticatedPage(html: string, pathname: string, context?: ManageBacErrorContext): void;
export declare function parseUpcomingHomeworkPage(html: string, baseUrl: string, pageUrl?: string): ParsedTaskPage;
export declare function parseTasksPage(html: string, baseUrl: string, pageUrl: string, expectedView: TaskView): ParsedTaskPage;
export declare function parseClassesPage(html: string, baseUrl: string, pageUrl?: string): ParsedClassesPage;
export declare function parseUnitsPage(html: string, baseUrl: string, pageUrl: string, expectedClassId: ReturnType<typeof parseEntityId<"class">>): ParsedUnitsPage;
export declare function parseTaskDetails(html: string, baseUrl: string, classId: ReturnType<typeof parseEntityId<"class">>, homeworkId: ReturnType<typeof parseEntityId<"task">>): HomeworkDetails;
export declare function parseTaskHintPath(html: string, baseUrl: string, classId: ReturnType<typeof parseEntityId<"class">>): string | null;
export declare function parseTaskHint(html: string, baseUrl: string, classId: ReturnType<typeof parseEntityId<"class">>, taskId: ReturnType<typeof parseEntityId<"task">>): TeacherSummary | null;
export declare function parseCalendarConfiguration(html: string): CalendarConfiguration;
export declare function parseCalendarEvents(json: string, baseUrl: string): readonly CalendarEvent[];
export declare function parseUserProfile(html: string, baseUrl: string): UserProfile;
//# sourceMappingURL=parsers.d.ts.map