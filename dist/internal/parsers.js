import * as cheerio from "cheerio";
import { AuthenticationError, DataIntegrityError, ParserError } from "../errors.js";
import { createEntityKey, parseEntityId, parseOpaqueEntityId } from "./identity.js";
export const TASKS_PARSER_VERSION = "tasks-and-deadlines/v2";
export const CLASSES_PARSER_VERSION = "student-classes/v1";
export const UNITS_PARSER_VERSION = "class-units/v1";
export const TASK_DETAILS_PARSER_VERSION = "core-task/v3";
export const TASK_HINT_PARSER_VERSION = "task-hint/v1";
export const CALENDAR_PARSER_VERSION = "student-calendar/v1";
export const PROFILE_PARSER_VERSION = "student-profile/v1";
export const LOGIN_PARSER_VERSION = "login/v1";
function cleanText(value) {
    return value.replace(/\s+/g, " ").trim();
}
export function parseLoginPage(html, context) {
    const $ = cheerio.load(html);
    const form = $("form#session_form, form[action='/sessions']").first();
    const authenticityToken = form.find("input[name='authenticity_token']").attr("value");
    if (!form.length || !authenticityToken) {
        throw new ParserError("Could not find the ManageBac login form. The sign-in page may have changed.", context === undefined ? {} : { context });
    }
    return { authenticityToken };
}
export function assertAuthenticatedPage(html, pathname, context) {
    const $ = cheerio.load(html);
    if (pathname === "/login" || $("form#session_form, form[action='/sessions']").length) {
        throw new AuthenticationError(undefined, context === undefined ? {} : { context });
    }
}
export function parseUpcomingHomeworkPage(html, baseUrl, pageUrl = new URL("/student/tasks_and_deadlines?view=upcoming", baseUrl).href) {
    return parseTasksPage(html, baseUrl, pageUrl, "upcoming");
}
export function parseTasksPage(html, baseUrl, pageUrl, expectedView) {
    const $ = cheerio.load(html);
    const body = $("body");
    const recognizedPage = body.hasClass("controller-student-tasks_and_deadlines")
        && body.attr("data-path") === "student/tasks_and_deadlines/index"
        && $(`a.active[href='/student/tasks_and_deadlines?view=${expectedView}']`).length === 1;
    if (!recognizedPage) {
        throw new ParserError("The response was not a recognized Tasks & Deadlines page.");
    }
    const tiles = $(".f-task-tile");
    const taskLinks = $("a[href*='/core_tasks/']");
    if (taskLinks.length > 0 && tiles.length === 0) {
        throw new ParserError("Task links exist, but the expected task containers are missing.");
    }
    const items = [];
    const seen = new Map();
    tiles.each((_, element) => {
        const tile = $(element);
        const taskLink = tile.find("a[href*='/core_tasks/']").first();
        const href = taskLink.attr("href");
        const match = href?.match(/^\/student\/classes\/(\d+)\/core_tasks\/(\d+)(?:[?#].*)?$/);
        if (!match?.[1] || !match[2] || !href) {
            throw new ParserError("A task was found, but its identifier could not be parsed.");
        }
        const classId = parseEntityId(match[1], "class");
        const homeworkId = parseEntityId(match[2], "task");
        const classLink = tile.find(`a[href='/student/classes/${classId}']`).first();
        const description = tile.find(".f-tile__description").first();
        const dueLabel = cleanText(description.find(".hstack > span").first().text());
        const tags = description.find(".badge-label").map((__, badge) => cleanText($(badge).text())).get().filter(Boolean);
        const status = cleanText(tile.find(".f-tile__suffix .f-task-score__body").text()) || null;
        const title = cleanText(taskLink.text());
        if (!title)
            throw new ParserError(`Task ${homeworkId} did not contain a title.`);
        const item = Object.freeze({
            kind: "task",
            id: homeworkId,
            key: createEntityKey(baseUrl, "task", homeworkId),
            source: Object.freeze({ provider: "managebac", domain: baseUrl }),
            title,
            url: new URL(href, baseUrl).href,
            class: Object.freeze({
                kind: "class",
                id: classId,
                key: createEntityKey(baseUrl, "class", classId),
                source: Object.freeze({ provider: "managebac", domain: baseUrl }),
                name: cleanText(classLink.text()) || null,
                url: new URL(`/student/classes/${classId}`, baseUrl).href,
            }),
            due: Object.freeze({ label: dueLabel || null, at: null, precision: null }),
            tags: Object.freeze(tags),
            status,
        });
        const fingerprint = JSON.stringify(item);
        const previous = seen.get(item.key);
        if (previous !== undefined && previous !== fingerprint) {
            throw new DataIntegrityError(`ManageBac returned conflicting records for task ${homeworkId}.`);
        }
        if (previous === undefined) {
            seen.set(item.key, fingerprint);
            items.push(item);
        }
    });
    const nextHref = $("a[rel='next'], .pagination .next a").first().attr("href");
    const nextPath = nextHref ? new URL(nextHref, pageUrl).href : null;
    return Object.freeze({ items: Object.freeze(items), nextPath });
}
export function parseClassesPage(html, baseUrl, pageUrl = new URL("/student/classes/my", baseUrl).href) {
    const $ = cheerio.load(html);
    const body = $("body");
    const recognizedPage = body.hasClass("controller-student-classes-classes")
        && body.attr("data-path") === "student/classes/classes/index";
    if (!recognizedPage)
        throw new ParserError("The response was not a recognized Classes page.");
    const items = [];
    const seen = new Map();
    $("main .f-class-tile").each((_, element) => {
        const tile = $(element);
        const link = tile.find(".f-tile__title-link[href^='/student/classes/']").first();
        const href = link.attr("href");
        const match = href?.match(/^\/student\/classes\/(\d+)(?:[?#].*)?$/);
        if (!match?.[1] || !href)
            throw new ParserError("A class was found, but its identifier could not be parsed.");
        const id = parseEntityId(match[1], "class");
        const name = cleanText(link.text());
        if (!name)
            throw new ParserError(`Class ${id} did not contain a name.`);
        const item = Object.freeze({
            kind: "class",
            id,
            key: createEntityKey(baseUrl, "class", id),
            source: Object.freeze({ provider: "managebac", domain: baseUrl }),
            name,
            url: new URL(href, baseUrl).href,
            tags: Object.freeze(tile.find(".f-tile__description .badge-label")
                .map((__, badge) => cleanText($(badge).text())).get().filter(Boolean)),
        });
        const itemFingerprint = JSON.stringify(item);
        const previous = seen.get(item.key);
        if (previous !== undefined && previous !== itemFingerprint) {
            throw new DataIntegrityError(`ManageBac returned conflicting records for class ${id}.`);
        }
        if (previous === undefined) {
            seen.set(item.key, itemFingerprint);
            items.push(item);
        }
    });
    const classLinksOutsideTiles = $("main a[href^='/student/classes/']").filter((_, link) => /^\/student\/classes\/\d+$/.test($(link).attr("href") ?? ""));
    if (classLinksOutsideTiles.length > 0 && items.length === 0) {
        throw new ParserError("Class links exist, but the expected class containers are missing.");
    }
    const nextHref = $("a[rel='next'], .pagination .next a").first().attr("href");
    return Object.freeze({
        items: Object.freeze(items),
        nextPath: nextHref ? new URL(nextHref, pageUrl).href : null,
    });
}
function parseCount(value) {
    const cleaned = cleanText(value);
    return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}
function classSummary(baseUrl, id, name) {
    return Object.freeze({
        kind: "class",
        id,
        key: createEntityKey(baseUrl, "class", id),
        source: Object.freeze({ provider: "managebac", domain: baseUrl }),
        name,
        url: new URL(`/student/classes/${id}`, baseUrl).href,
    });
}
export function parseUnitsPage(html, baseUrl, pageUrl, expectedClassId) {
    const $ = cheerio.load(html);
    if ($("body").attr("data-path") !== "student/classes/units/index") {
        throw new ParserError("The response was not a recognized class Units page.");
    }
    const className = cleanText($("main .f-hero__title").first().text()) || null;
    const parentClass = classSummary(baseUrl, expectedClassId, className);
    const items = [];
    const seen = new Map();
    $("main .unit-component.unit").each((_, element) => {
        const unit = $(element);
        const link = unit.find(".unit-details a[href*='/units/']").first();
        const href = link.attr("href");
        const match = href?.match(/^\/student\/classes\/(\d+)\/units\/(\d+)\/presentations(?:[?#].*)?$/);
        if (!match?.[1] || !match[2] || !href)
            throw new ParserError("A unit was found, but its identifier could not be parsed.");
        if (match[1] !== expectedClassId)
            throw new DataIntegrityError("A unit referenced an unexpected class.");
        const id = parseEntityId(match[2], "unit");
        const name = cleanText(link.text());
        if (!name)
            throw new ParserError(`Unit ${id} did not contain a name.`);
        const status = unit.hasClass("completed") ? "completed"
            : unit.hasClass("current") ? "current"
                : unit.hasClass("upcoming") ? "upcoming"
                    : "unknown";
        const item = Object.freeze({
            kind: "unit",
            id,
            key: createEntityKey(baseUrl, "unit", id),
            source: Object.freeze({ provider: "managebac", domain: baseUrl }),
            name,
            url: new URL(href.split("#", 1)[0], baseUrl).href,
            class: parentClass,
            status,
            tags: Object.freeze(unit.find(".unit-details .badge-label").map((__, badge) => cleanText($(badge).text())).get().filter(Boolean)),
            schedule: Object.freeze({
                startsLabel: cleanText(unit.find(".label-start").first().text()) || null,
                durationLabel: cleanText(unit.find(".unit-duration").first().text()) || null,
            }),
            counts: Object.freeze({
                lessons: parseCount(unit.find(".lessons .number").first().text()),
                tasks: parseCount(unit.find(".tasks .number").first().text()),
            }),
        });
        const itemFingerprint = JSON.stringify(item);
        const previous = seen.get(item.key);
        if (previous !== undefined && previous !== itemFingerprint) {
            throw new DataIntegrityError(`ManageBac returned conflicting records for unit ${id}.`);
        }
        if (previous === undefined) {
            seen.set(item.key, itemFingerprint);
            items.push(item);
        }
    });
    const nextHref = $("a[rel='next'], .pagination .next a").first().attr("href");
    return Object.freeze({
        items: Object.freeze(items),
        nextPath: nextHref ? new URL(nextHref, pageUrl).href : null,
    });
}
export function parseTaskDetails(html, baseUrl, classId, homeworkId) {
    const $ = cheerio.load(html);
    if ($("body").attr("data-path") !== "student/classes/core_tasks/show") {
        throw new ParserError("The response was not a recognized task details page.");
    }
    const root = $("main .core-task-show").first();
    if (!root.length)
        throw new ParserError("The task details container is missing.");
    const title = cleanText(root.find(".short-assignment .h4.title").first().text());
    if (!title)
        throw new ParserError(`Task ${homeworkId} did not contain a title.`);
    const taskHref = `/student/classes/${classId}/core_tasks/${homeworkId}`;
    const className = cleanText($("main .f-hero__title").first().text()) || null;
    const unitLink = root.find(".unit-details a[href*='/units/']").first();
    const unitHref = unitLink.attr("href");
    const unitMatch = unitHref?.match(/^\/student\/classes\/(\d+)\/units\/(\d+)\/presentations(?:[?#].*)?$/);
    let relatedUnit = null;
    if (unitMatch?.[1] && unitMatch[2] && unitHref) {
        if (unitMatch[1] !== classId)
            throw new DataIntegrityError("The task's unit referenced an unexpected class.");
        const unitId = parseEntityId(unitMatch[2], "unit");
        const unitName = cleanText(unitLink.text());
        if (!unitName)
            throw new ParserError("The task's related unit did not contain a name.");
        relatedUnit = Object.freeze({
            kind: "unit",
            id: unitId,
            key: createEntityKey(baseUrl, "unit", unitId),
            source: Object.freeze({ provider: "managebac", domain: baseUrl }),
            name: unitName,
            url: new URL(unitHref.split("#", 1)[0], baseUrl).href,
        });
    }
    const attachments = [];
    const attachmentKeys = new Set();
    root.find(".core-task-details a.fr-file[data-name][href]").each((_, element) => {
        const link = $(element);
        const attachmentUrl = new URL(link.attr("href"), baseUrl);
        if (attachmentUrl.origin !== baseUrl || !attachmentUrl.pathname.startsWith("/attachments/")) {
            throw new DataIntegrityError("A task attachment pointed outside the configured ManageBac domain.");
        }
        const id = parseOpaqueEntityId(attachmentUrl.pathname.slice("/attachments/".length), "attachment");
        const attachment = Object.freeze({
            kind: "attachment",
            id,
            key: createEntityKey(baseUrl, "attachment", id),
            source: Object.freeze({ provider: "managebac", domain: baseUrl }),
            name: cleanText(link.attr("data-name") ?? link.text()),
            sizeLabel: cleanText(link.find(".fr-file-size").text()) || null,
            url: attachmentUrl.href,
        });
        if (!attachmentKeys.has(attachment.key)) {
            attachmentKeys.add(attachment.key);
            attachments.push(attachment);
        }
    });
    const assessment = root.find(".short-assignment .assessment").first();
    const statusLabel = cleanText(assessment.text()) || null;
    const submissionStatus = assessment.find(".cell.submitted").length
        ? "submitted"
        : assessment.find(".cell.not-submitted").length
            ? "not-submitted"
            : assessment.find(".label-not-applicable").length
                ? "not-required"
                : "unknown";
    const submission = Object.freeze({
        status: submissionStatus,
        statusLabel,
        submittedAt: null,
        feedbackText: cleanText(root.find(".assessment-comments .fr-view").first().text()) || null,
    });
    return Object.freeze({
        kind: "task",
        id: homeworkId,
        key: createEntityKey(baseUrl, "task", homeworkId),
        source: Object.freeze({ provider: "managebac", domain: baseUrl }),
        title,
        url: new URL(taskHref, baseUrl).href,
        class: classSummary(baseUrl, classId, className),
        due: Object.freeze({
            label: cleanText(root.find(".label-and-due .due-date").first().text()) || null,
            at: null,
            precision: null,
        }),
        tags: Object.freeze(root.find(".label-and-due .label").map((_, label) => cleanText($(label).text())).get().filter(Boolean)),
        status: statusLabel,
        descriptionText: cleanText(root.find(".core-task-details .fr-view").first().text()) || null,
        teacher: null,
        submission,
        assessmentLabel: cleanText(root.find(".assessment .label").first().text()) || null,
        unit: relatedUnit,
        attachments: Object.freeze(attachments),
    });
}
export function parseTaskHintPath(html, baseUrl, classId) {
    const $ = cheerio.load(html);
    const href = $("main .core-task-show .short-assignment .fusion-popover[data-bs-content-url]")
        .first()
        .attr("data-bs-content-url");
    if (!href)
        return null;
    const url = new URL(href, baseUrl);
    if (url.origin !== baseUrl)
        throw new DataIntegrityError("The task hint pointed outside the configured ManageBac domain.");
    const match = url.pathname.match(/^\/student\/classes\/(\d+)\/events\/\d+\/hint$/);
    if (!match?.[1])
        throw new ParserError("The task hint URL had an unexpected shape.");
    if (match[1] !== classId)
        throw new DataIntegrityError("The task hint referenced an unexpected class.");
    return url.href;
}
export function parseTaskHint(html, baseUrl, classId, taskId) {
    const $ = cheerio.load(html);
    const taskHref = $("a[href*='/core_tasks/']").first().attr("href");
    const match = taskHref?.match(/^\/student\/classes\/(\d+)\/core_tasks\/(\d+)(?:[?#].*)?$/);
    if (!match?.[1] || !match[2])
        throw new ParserError("The response was not a recognized task hint.");
    if (match[1] !== classId || match[2] !== taskId) {
        throw new DataIntegrityError("The task hint referenced an unexpected task.");
    }
    const teacherRow = $(".d-flex.gap-1").filter((_, element) => $(element).find("dt .fi-users").length > 0).first();
    if (!teacherRow.length)
        return null;
    const name = cleanText(teacherRow.find("dd").first().text());
    if (!name)
        throw new ParserError("The task hint contained an empty teacher attribution.");
    return Object.freeze({
        kind: "teacher",
        id: null,
        key: null,
        source: Object.freeze({ provider: "managebac", domain: baseUrl }),
        name,
        url: null,
    });
}
export function parseCalendarConfiguration(html) {
    const $ = cheerio.load(html);
    if ($("body").attr("data-path") !== "student/calendars/show") {
        throw new ParserError("The response was not a recognized student Calendar page.");
    }
    const calendar = $("[data-controller='full-calendar--component']").first();
    const timezone = calendar.attr("data-timezone");
    const eventsPath = calendar.attr("data-full-calendar--component-source-url-value");
    if (!calendar.length || !timezone || !eventsPath) {
        throw new ParserError("The calendar configuration is incomplete.");
    }
    try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    }
    catch (cause) {
        throw new DataIntegrityError(`ManageBac returned an invalid calendar timezone: ${timezone}`, { cause });
    }
    return Object.freeze({ timezone, eventsPath });
}
function isoDateTime(value, field) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${value}T00:00:00.000Z`;
    }
    const hasExplicitTimezone = typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    if (!hasExplicitTimezone || Number.isNaN(Date.parse(value))) {
        throw new DataIntegrityError(`Calendar event ${field} was not a valid date-time.`);
    }
    return new Date(value).toISOString();
}
export function parseCalendarEvents(json, baseUrl) {
    let input;
    try {
        input = JSON.parse(json);
    }
    catch (cause) {
        throw new ParserError("ManageBac returned invalid calendar JSON.", { cause });
    }
    if (!Array.isArray(input))
        throw new ParserError("ManageBac calendar data was not an array.");
    const items = [];
    const seen = new Map();
    for (const raw of input) {
        if (!raw || typeof raw !== "object")
            throw new DataIntegrityError("A calendar event was not an object.");
        const event = raw;
        const id = parseEntityId(String(event["id"] ?? ""), "calendar-event");
        if (typeof event["title"] !== "string" || event["title"].trim() === "") {
            throw new DataIntegrityError(`Calendar event ${id} did not contain a title.`);
        }
        if (typeof event["allDay"] !== "boolean" || typeof event["type"] !== "string") {
            throw new DataIntegrityError(`Calendar event ${id} had invalid core fields.`);
        }
        const startsAt = isoDateTime(event["start"], "start");
        const endsAt = event["end"] === null || event["end"] === undefined ? null : isoDateTime(event["end"], "end");
        let url = null;
        if (typeof event["url"] === "string" && event["url"] !== "") {
            const parsedUrl = new URL(event["url"], baseUrl);
            if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
                throw new DataIntegrityError(`Calendar event ${id} had an unsafe URL.`);
            }
            url = parsedUrl.href;
        }
        let relatedTask = null;
        if (url) {
            const parsedUrl = new URL(url);
            const match = parsedUrl.origin === baseUrl
                ? parsedUrl.pathname.match(/^\/student\/classes\/(\d+)\/core_tasks\/(\d+)$/)
                : null;
            if (match?.[1] && match[2]) {
                const classId = parseEntityId(match[1], "class");
                const taskId = parseEntityId(match[2], "task");
                relatedTask = Object.freeze({
                    kind: "task",
                    id: taskId,
                    key: createEntityKey(baseUrl, "task", taskId),
                    url,
                    classId,
                });
            }
        }
        const descriptionText = typeof event["description"] === "string"
            ? cleanText(cheerio.load(event["description"]).text()) || null
            : null;
        const item = Object.freeze({
            kind: "calendar-event",
            id,
            key: createEntityKey(baseUrl, "calendar-event", id),
            source: Object.freeze({ provider: "managebac", domain: baseUrl }),
            title: cleanText(event["title"]),
            startsAt,
            endsAt,
            allDay: event["allDay"],
            descriptionText,
            eventType: event["type"],
            categoryLabel: typeof event["category"] === "string" && cleanText(event["category"]) ? cleanText(event["category"]) : null,
            color: typeof event["backgroundColor"] === "string" && event["backgroundColor"] ? event["backgroundColor"] : null,
            url,
            relatedTask,
        });
        const itemFingerprint = JSON.stringify(item);
        const previous = seen.get(item.key);
        if (previous !== undefined && previous !== itemFingerprint) {
            throw new DataIntegrityError(`ManageBac returned conflicting records for calendar event ${id}.`);
        }
        if (previous === undefined) {
            seen.set(item.key, itemFingerprint);
            items.push(item);
        }
    }
    return Object.freeze(items);
}
export function parseUserProfile(html, baseUrl) {
    const $ = cheerio.load(html);
    const body = $("body");
    if (body.attr("data-path") !== "student/profiles/show") {
        throw new ParserError("The response was not a recognized student Profile page.");
    }
    const id = parseEntityId(body.attr("data-user-id") ?? "", "user");
    const name = cleanText($("main .f-hero__title").first().text());
    if (!name)
        throw new ParserError("The student profile did not contain a name.");
    const roleLabel = cleanText(body.attr("data-web-analytics-user-role-value") ?? "") || null;
    const normalizedRole = roleLabel?.toLowerCase();
    const role = normalizedRole === "student" ? "student"
        : normalizedRole === "teacher" ? "teacher"
            : normalizedRole === "administrator" || normalizedRole === "admin" ? "administrator"
                : normalizedRole === "parent" ? "parent"
                    : "unknown";
    return Object.freeze({
        kind: "user",
        id,
        key: createEntityKey(baseUrl, "user", id),
        source: Object.freeze({ provider: "managebac", domain: baseUrl }),
        name,
        role,
        roleLabel,
        programme: cleanText(body.attr("data-web-analytics-program-value") ?? "") || null,
        url: new URL("/student/profile", baseUrl).href,
    });
}
//# sourceMappingURL=parsers.js.map