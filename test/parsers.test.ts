import { describe, expect, test } from "bun:test";
import { DataIntegrityError, ParserError } from "../src/errors.js";
import {
  parseCalendarConfiguration,
  parseCalendarEvents,
  parseClassesPage,
  parseTaskDetails,
  parseTaskHint,
  parseTaskHintPath,
  parseTasksPage,
  parseLoginPage,
  parseUnitsPage,
  parseUpcomingHomeworkPage,
  parseUserProfile,
} from "../src/internal/parsers.js";

describe("calendar parsers", () => {
  test("extracts configuration and typed event relationships", () => {
    expect(parseCalendarConfiguration(`
      <body data-path="student/calendars/show">
        <div data-controller="full-calendar--component" data-timezone="Europe/Oslo"
          data-full-calendar--component-source-url-value="/student/events.json"></div>
      </body>
    `)).toEqual({ timezone: "Europe/Oslo", eventsPath: "/student/events.json" });

    const events = parseCalendarEvents(JSON.stringify([{
      id: 91,
      title: "Essay",
      start: "2026-09-25T08:15:00+02:00",
      end: null,
      allDay: false,
      description: "<p>Read <strong>carefully</strong></p>",
      type: "CoreTask",
      category: "Homework",
      backgroundColor: "#123456",
      url: "/student/classes/42/core_tasks/9001",
    }]), "https://school.managebac.com");
    expect(events[0]?.kind).toBe("calendar-event");
    expect(String(events[0]?.id)).toBe("91");
    expect(events[0]?.descriptionText).toBe("Read carefully");
    expect(String(events[0]?.startsAt)).toBe("2026-09-25T06:15:00.000Z");
    expect(String(events[0]?.relatedTask?.id)).toBe("9001");
    expect(String(events[0]?.relatedTask?.classId)).toBe("42");
  });

  test("rejects malformed JSON and invalid timestamps", () => {
    expect(() => parseCalendarEvents("not-json", "https://school.managebac.com")).toThrow(ParserError);
    expect(() => parseCalendarEvents(JSON.stringify([{
      id: 1, title: "Event", start: "not-a-date", allDay: false, type: "Event",
    }]), "https://school.managebac.com")).toThrow(DataIntegrityError);
  });

  test("normalizes all-day calendar dates without inventing a time-of-day", () => {
    const [event] = parseCalendarEvents(JSON.stringify([{
      id: 92, title: "School holiday", start: "2026-10-01", allDay: true, type: "Event",
    }]), "https://school.managebac.com");
    expect(String(event?.startsAt)).toBe("2026-10-01T00:00:00.000Z");
    expect(event?.allDay).toBe(true);
  });
});

test("parses the signed-in user as a stable entity", () => {
  const profile = parseUserProfile(`
    <body data-path="student/profiles/show" data-user-id="123"
      data-web-analytics-user-role-value="Student"
      data-web-analytics-program-value="diploma">
      <main><h1 class="f-hero__title">Ada Student</h1></main>
    </body>
  `, "https://school.managebac.com");
  expect(profile as unknown).toEqual({
    kind: "user",
    id: "123",
    key: "managebac://school.managebac.com/user/123",
    source: { provider: "managebac", domain: "https://school.managebac.com" },
    name: "Ada Student",
    role: "student",
    roleLabel: "Student",
    programme: "diploma",
    url: "https://school.managebac.com/student/profile",
  });
});

const page = (content: string, view = "upcoming"): string => `
  <html><body class="controller-student-tasks_and_deadlines" data-path="student/tasks_and_deadlines/index">
    <a class="active" href="/student/tasks_and_deadlines?view=${view}">${view}</a>
    <main>${content}</main>
  </body></html>
`;

const tile = ({ title = "Read chapter 4", due = "Sep 25, 8:15 AM" } = {}): string => `
  <div class="f-task-tile">
    <div class="f-tile__body">
      <a class="f-tile__title-link" href="/student/classes/42/core_tasks/9001"><span>${title}</span></a>
      <div class="f-tile__description"><div class="hstack">
        <span><svg></svg>${due}</span>
        <a href="/student/classes/42">Literature</a>
        <span class="badge"><span class="badge-label">Homework</span></span>
      </div></div>
    </div>
    <div class="f-tile__suffix"><div class="f-task-score__body">Not Assessed Yet</div></div>
  </div>
`;

describe("parseLoginPage", () => {
  test("extracts the CSRF token", () => {
    expect(parseLoginPage(`
      <form id="session_form" action="/sessions">
        <input name="authenticity_token" value="csrf-value">
      </form>
    `)).toEqual({ authenticityToken: "csrf-value" });
  });

  test("reports parser drift", () => {
    expect(() => parseLoginPage("<main>changed</main>")).toThrow(ParserError);
  });
});

describe("parseUpcomingHomeworkPage", () => {
  test("extracts typed, immutable records with stable source keys", () => {
    const result = parseUpcomingHomeworkPage(page(tile()), "https://school.managebac.com");
    expect(result.items as unknown).toEqual([{
      kind: "task",
      id: "9001",
      key: "managebac://school.managebac.com/task/9001",
      source: { provider: "managebac", domain: "https://school.managebac.com" },
      title: "Read chapter 4",
      url: "https://school.managebac.com/student/classes/42/core_tasks/9001",
      class: {
        kind: "class",
        id: "42",
        key: "managebac://school.managebac.com/class/42",
        source: { provider: "managebac", domain: "https://school.managebac.com" },
        name: "Literature",
        url: "https://school.managebac.com/student/classes/42",
      },
      due: { label: "Sep 25, 8:15 AM", at: null, precision: null },
      tags: ["Homework"],
      status: "Not Assessed Yet",
    }]);
    expect(Object.isFrozen(result.items[0]?.tags)).toBe(true);
  });

  test("returns an empty list only on a recognized tasks page", () => {
    expect(parseUpcomingHomeworkPage(page(""), "https://school.managebac.com").items).toEqual([]);
    expect(() => parseUpcomingHomeworkPage("<main></main>", "https://school.managebac.com")).toThrow(ParserError);
  });

  test("deduplicates byte-equivalent records", () => {
    expect(parseUpcomingHomeworkPage(page(tile() + tile()), "https://school.managebac.com").items).toHaveLength(1);
  });

  test("rejects conflicting records with the same source ID", () => {
    expect(() => parseUpcomingHomeworkPage(
      page(tile() + tile({ title: "Different title" })),
      "https://school.managebac.com",
    )).toThrow(DataIntegrityError);
  });

  test("fails loudly when a task URL changes shape", () => {
    expect(() => parseUpcomingHomeworkPage(
      page('<div class="f-task-tile"><a href="/new/tasks/1">Task</a></div>'),
      "https://school.managebac.com",
    )).toThrow(ParserError);
  });

  test("extracts pagination without interpreting it", () => {
    const result = parseUpcomingHomeworkPage(
      page('<nav class="pagination"><a rel="next" href="?page=2&view=upcoming">Next</a></nav>'),
      "https://school.managebac.com",
    );
    expect(result.nextPath).toBe("https://school.managebac.com/student/tasks_and_deadlines?page=2&view=upcoming");
  });

  test("verifies the requested task view", () => {
    expect(parseTasksPage(
      page(tile(), "overdue"),
      "https://school.managebac.com",
      "https://school.managebac.com/student/tasks_and_deadlines?view=overdue",
      "overdue",
    ).items).toHaveLength(1);
    expect(() => parseTasksPage(
      page(tile(), "past"),
      "https://school.managebac.com",
      "https://school.managebac.com/student/tasks_and_deadlines?view=past",
      "overdue",
    )).toThrow(ParserError);
  });
});

describe("parseClassesPage", () => {
  test("extracts classes with the same identity model", () => {
    const result = parseClassesPage(`
      <body class="controller-student-classes-classes" data-path="student/classes/classes/index">
        <main><div class="f-class-tile">
          <a class="f-tile__title-link" href="/student/classes/42">Literature</a>
          <div class="f-tile__description"><span class="badge-label">HL</span></div>
        </div></main>
      </body>
    `, "https://school.managebac.com");
    expect(result.items[0] as unknown).toEqual({
      kind: "class",
      id: "42",
      key: "managebac://school.managebac.com/class/42",
      source: { provider: "managebac", domain: "https://school.managebac.com" },
      name: "Literature",
      url: "https://school.managebac.com/student/classes/42",
      tags: ["HL"],
    });
  });
});

describe("class resource parsers", () => {
  test("extracts units and their class relationship", () => {
    const html = `
      <body data-path="student/classes/units/index"><main>
        <h1 class="f-hero__title">Literature</h1>
        <div class="unit-component unit current">
          <div class="unit-details">
            <a href="/student/classes/42/units/77/presentations#show_at_a_glance">Poetry</a>
            <span class="badge-label">HL</span>
            <span class="label-start">Starts W3 Sep</span>
            <span class="unit-duration">4 Weeks</span>
          </div>
          <div class="lessons"><div class="number">3</div></div>
          <div class="tasks"><div class="number">5</div></div>
        </div>
      </main></body>`;
    const result = parseUnitsPage(
      html,
      "https://school.managebac.com",
      "https://school.managebac.com/student/classes/42/units",
      "42" as never,
    );
    expect(result.items[0] as unknown).toEqual({
      kind: "unit",
      id: "77",
      key: "managebac://school.managebac.com/unit/77",
      source: { provider: "managebac", domain: "https://school.managebac.com" },
      name: "Poetry",
      url: "https://school.managebac.com/student/classes/42/units/77/presentations",
      class: {
        kind: "class",
        id: "42",
        key: "managebac://school.managebac.com/class/42",
        source: { provider: "managebac", domain: "https://school.managebac.com" },
        name: "Literature",
        url: "https://school.managebac.com/student/classes/42",
      },
      status: "current",
      tags: ["HL"],
      schedule: { startsLabel: "Starts W3 Sep", durationLabel: "4 Weeks" },
      counts: { lessons: 3, tasks: 5 },
    });
  });

  test("extracts task details, unit, and attachments", () => {
    const html = `
      <body data-path="student/classes/core_tasks/show"><main>
        <h1 class="f-hero__title">Literature</h1>
        <div class="core-task-show">
          <div class="short-assignment">
            <div class="h4 title">Essay</div>
            <span class="fusion-popover" data-bs-content-url="/student/classes/42/events/9001/hint"></span>
            <div class="label-and-due">
              <span class="label">Homework</span>
              <span class="due-date">Friday at 8:15 AM</span>
            </div>
            <div class="assessment"><span class="cell submitted">Complete</span></div>
          </div>
          <div class="unit-details"><a href="/student/classes/42/units/77/presentations">Poetry</a></div>
          <div class="core-task-details"><div class="fr-view">
            Read pages 1–5
            <a class="fr-file" data-name="brief.pdf" href="/attachments/signed-token">
              <span class="fr-file-size">12 KB</span>
            </a>
          </div></div>
          <div class="assessment-comments"><div class="fr-view">Strong analysis.</div></div>
        </div>
      </main></body>`;
    const result = parseTaskDetails(
      html,
      "https://school.managebac.com",
      "42" as never,
      "9001" as never,
    );
    expect(result.title).toBe("Essay");
    expect(String(result.unit?.id)).toBe("77");
    expect(result.attachments[0]?.name).toBe("brief.pdf");
    expect(String(result.attachments[0]?.key)).toBe("managebac://school.managebac.com/attachment/signed-token");
    expect(result.descriptionText).toContain("Read pages 1–5");
    expect(result.submission).toEqual({
      status: "submitted",
      statusLabel: "Complete",
      submittedAt: null,
      feedbackText: "Strong analysis.",
    });
    expect(parseTaskDetails(
      html.replace('class="cell submitted">Complete', 'class="cell not-submitted">Not submitted'),
      "https://school.managebac.com",
      "42" as never,
      "9001" as never,
    ).submission.status).toBe("not-submitted");
    expect(parseTaskDetails(
      html.replace('<span class="cell submitted">Complete</span>', '<span class="label-not-applicable">N/A</span>'),
      "https://school.managebac.com",
      "42" as never,
      "9001" as never,
    ).submission.status).toBe("not-required");
    expect(result.teacher).toBeNull();
    expect(parseTaskHintPath(html, "https://school.managebac.com", "42" as never))
      .toBe("https://school.managebac.com/student/classes/42/events/9001/hint");

    const teacher = parseTaskHint(`
      <h2>Task</h2>
      <a href="/student/classes/42/core_tasks/9001">Essay</a>
      <dl><div class="d-flex gap-1">
        <dt class="flex-shrink-0"><svg class="fi fi-users"></svg><span class="fw-semibold">Teacher:</span></dt>
        <dd class="mb-0"><div class="avatar micro"></div> Ada Lovelace </dd>
      </div></dl>
    `, "https://school.managebac.com", "42" as never, "9001" as never);
    expect(teacher).toEqual({
      kind: "teacher",
      id: null,
      key: null,
      source: { provider: "managebac", domain: "https://school.managebac.com" },
      name: "Ada Lovelace",
      url: null,
    });
  });
});
