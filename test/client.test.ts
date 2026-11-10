import { expect, test } from "bun:test";
import { AuthenticationError, ManageBacClient } from "../src/index.js";
import type { FetchImplementation } from "../src/types.js";
import type { ManageBacEvent } from "../src/types.js";

function response(body: BodyInit | null, options: { status?: number; url: string; headers?: HeadersInit }): Response {
  const result = new Response(body, {
    status: options.status ?? 200,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  Object.defineProperty(result, "url", { value: options.url });
  return result;
}

const emptyTasksPage = `
  <body class="controller-student-tasks_and_deadlines" data-path="student/tasks_and_deadlines/index">
    <a class="active" href="/student/tasks_and_deadlines?view=upcoming">Upcoming</a>
    <main>No upcoming tasks</main>
  </body>
`;

test("logs in once and coalesces concurrent homework requests", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchImplementation = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    requests.push({ url: url.href, init });
    if (url.pathname === "/login") {
      return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', {
        url: url.href,
        headers: { "set-cookie": "session=first; Path=/; Secure; HttpOnly" },
      });
    }
    if (url.pathname === "/sessions") {
      return response("", {
        status: 302,
        url: url.href,
        headers: { location: "/student/calendar", "set-cookie": "session=authenticated; Path=/; Secure; HttpOnly" },
      });
    }
    if (url.pathname === "/student/calendar") {
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      return response("<main>Calendar</main>", { url: url.href });
    }
    return response(emptyTasksPage, { url: url.href });
  };

  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    fetch,
    now: () => new Date("2026-09-24T10:00:00.000Z"),
  });

  const [first, second] = await Promise.all([
    client.getUpcomingHomeworkSnapshot(),
    client.getUpcomingHomeworkSnapshot(),
  ]);
  expect(first).toBe(second);
  expect(first as unknown).toEqual({
    items: [],
    fetchedAt: "2026-09-24T10:00:00.000Z",
    sourceUrl: "https://school.managebac.com/student/tasks_and_deadlines?view=upcoming",
    parserVersion: "tasks-and-deadlines/v2",
    completeness: "complete",
  });
  expect(client.authenticated).toBe(true);
  expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
    "/login", "/sessions", "/student/calendar", "/student/tasks_and_deadlines",
  ]);
  expect(new URLSearchParams(String(requests[1]?.init.body)).get("remember_me")).toBe("1");
  expect(new Headers(requests[2]?.init.headers).get("cookie")).toContain("session=authenticated");
});

test("joins task deadlines from authoritative calendar events", async () => {
  const fetch: FetchImplementation = async (input) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/login") {
      return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', { url: url.href });
    }
    if (url.pathname === "/sessions") {
      return response("", { status: 302, url: url.href, headers: { location: "/student/calendar" } });
    }
    if (url.pathname === "/student/calendar") {
      return response(`
        <body data-path="student/calendars/show">
          <div data-controller="full-calendar--component" data-timezone="Europe/Oslo"
            data-full-calendar--component-source-url-value="/student/events.json"></div>
        </body>
      `, { url: url.href });
    }
    if (url.pathname === "/student/events.json") {
      return response(JSON.stringify([{
        id: 55,
        title: "Essay",
        start: "2026-09-30T08:15:00+02:00",
        end: null,
        allDay: false,
        type: "CoreTask",
        url: "/student/classes/42/core_tasks/9001",
      }]), { url: url.href });
    }
    return response(`
      <body class="controller-student-tasks_and_deadlines" data-path="student/tasks_and_deadlines/index">
        <a class="active" href="/student/tasks_and_deadlines?view=upcoming">Upcoming</a>
        <main><div class="f-task-tile"><div class="f-tile__body">
          <a class="f-tile__title-link" href="/student/classes/42/core_tasks/9001">Essay</a>
          <div class="f-tile__description"><div class="hstack">
            <span>Sep 30, 8:15 AM</span><a href="/student/classes/42">Literature</a>
          </div></div>
        </div></div></main>
      </body>
    `, { url: url.href });
  };
  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    fetch,
  });

  const [task] = await client.tasks.listUpcoming();
  expect(task?.due.label).toBe("Sep 30, 8:15 AM");
  expect(String(task?.due.at)).toBe("2026-09-30T06:15:00.000Z");
  expect(task?.due.precision).toBe("date-time");
});

test("can opt out of ManageBac's persistent session cookie", async () => {
  const submission: { rememberMe: string | null } = { rememberMe: null };
  const fetch: FetchImplementation = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/login") {
      return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', {
        url: url.href,
      });
    }
    submission.rememberMe = new URLSearchParams(String(init.body)).get("remember_me");
    return response("<main>Calendar</main>", { url: "https://school.managebac.com/student/calendar" });
  };

  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    rememberMe: false,
    fetch,
  });

  await client.login();
  expect(submission.rememberMe).toBe("0");
});

test("hydrates task descriptions and teacher attribution from task details", async () => {
  const paths: string[] = [];
  const fetch: FetchImplementation = async (input) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    paths.push(url.pathname);
    if (url.pathname === "/login") {
      return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', {
        url: url.href,
      });
    }
    if (url.pathname === "/sessions") {
      return response("", { status: 302, url: url.href, headers: { location: "/student/calendar" } });
    }
    if (url.pathname === "/student/calendar") {
      return response(`
        <body data-path="student/calendars/show">
          <div data-controller="full-calendar--component" data-timezone="Europe/Oslo"
            data-full-calendar--component-source-url-value="/student/events.json"></div>
        </body>
      `, { url: url.href });
    }
    if (url.pathname === "/student/events.json") {
      return response(JSON.stringify([{
        id: 55,
        title: "Essay",
        start: "2026-09-30T08:15:00+02:00",
        end: null,
        allDay: false,
        type: "CoreTask",
        url: "/student/classes/42/core_tasks/9001",
      }]), { url: url.href });
    }
    if (url.pathname === "/student/classes/42/core_tasks/9001") {
      return response(`
        <body data-path="student/classes/core_tasks/show"><main>
          <h1 class="f-hero__title">Literature</h1>
          <div class="core-task-show">
            <div class="short-assignment">
              <div class="h4 title">Essay</div>
              <span class="fusion-popover" data-bs-content-url="/student/classes/42/events/55/hint"></span>
            </div>
            <div class="core-task-details"><div class="fr-view">Read chapter five.</div></div>
          </div>
        </main></body>
      `, { url: url.href });
    }
    return response(`
      <a href="/student/classes/42/core_tasks/9001">Essay</a>
      <div class="d-flex gap-1">
        <dt><svg class="fi fi-users"></svg><span>Teacher:</span></dt>
        <dd>Ada Lovelace</dd>
      </div>
    `, { url: url.href });
  };
  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    fetch,
  });

  const details = await client.classes.byId("42").tasks.byId("9001").get();
  expect(details.descriptionText).toBe("Read chapter five.");
  expect(String(details.due.at)).toBe("2026-09-30T06:15:00.000Z");
  expect(details.due.precision).toBe("date-time");
  expect(details.teacher?.name).toBe("Ada Lovelace");
  expect(details.teacher?.id).toBeNull();
  expect(paths).toContain("/student/classes/42/events/55/hint");
});

test("turns a returned login page into an authentication error", async () => {
  const fetch: FetchImplementation = async () => response(`
    <form id="session_form" action="/sessions">
      <input name="authenticity_token" value="token">
      <p class="alert">Invalid login or password</p>
    </form>
  `, { url: "https://school.managebac.com/login" });

  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "bad-password",
    fetch,
  });
  expect(client.login()).rejects.toBeInstanceOf(AuthenticationError);
});

test("reauthenticates once when a protected request returns the login page", async () => {
  let loginPosts = 0;
  let taskRequests = 0;
  const loginPage = '<form action="/sessions"><input name="authenticity_token" value="token"></form>';
  const fetch: FetchImplementation = async (input) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/login") return response(loginPage, { url: url.href });
    if (url.pathname === "/sessions") {
      loginPosts += 1;
      return response("", { status: 302, url: url.href, headers: { location: "/student/calendar" } });
    }
    if (url.pathname === "/student/calendar") return response("<main>Calendar</main>", { url: url.href });
    taskRequests += 1;
    return taskRequests === 1
      ? response(loginPage, { url: "https://school.managebac.com/login" })
      : response(emptyTasksPage, { url: url.href });
  };

  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    fetch,
  });
  expect(await client.getUpcomingHomework()).toEqual([]);
  expect(loginPosts).toBe(2);
  expect(taskRequests).toBe(2);
});

test("caches validated snapshots and emits lifecycle events", async () => {
  let requests = 0;
  const events: ManageBacEvent[] = [];
  const fetch: FetchImplementation = async (input) => {
    requests += 1;
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/login") {
      return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', { url: url.href });
    }
    if (url.pathname === "/sessions") {
      return response("", { status: 302, url: url.href, headers: { location: "/student/calendar" } });
    }
    if (url.pathname === "/student/calendar") return response("<main>Calendar</main>", { url: url.href });
    return response(emptyTasksPage, { url: url.href });
  };
  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    fetch,
    cache: { ttlMs: 60_000 },
    observer: (event) => { events.push(event); },
  });

  await client.homework.snapshotUpcoming();
  const afterFirst = requests;
  await client.homework.snapshotUpcoming();
  expect(requests).toBe(afterFirst);
  expect(events.some((event) => event.type === "cache:set")).toBe(true);
  expect(events.some((event) => event.type === "cache:hit")).toBe(true);
  expect(events.some((event) => event.type === "parse:end")).toBe(true);

  await client.cache.clear();
  await client.homework.snapshotUpcoming();
  expect(requests).toBeGreaterThan(afterFirst);
});

test("retries configured transient GET responses and reports the retry", async () => {
  let loginGets = 0;
  const events: ManageBacEvent[] = [];
  const fetch: FetchImplementation = async (input) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/login" && loginGets++ === 0) {
      return response("temporary", { status: 503, url: url.href, headers: { "retry-after": "0" } });
    }
    if (url.pathname === "/login") {
      return response('<form action="/sessions"><input name="authenticity_token" value="token"></form>', { url: url.href });
    }
    if (url.pathname === "/sessions") {
      return response("", { status: 302, url: url.href, headers: { location: "/student/calendar" } });
    }
    return response("<main>Calendar</main>", { url: url.href });
  };
  const client = new ManageBacClient({
    domain: "school.managebac.com",
    username: "student",
    password: "password",
    fetch,
    retry: { maxRetries: 1, baseDelayMs: 0 },
    observer: (event) => { events.push(event); },
  });
  await client.login();
  expect(loginGets).toBe(2);
  expect(events.filter((event) => event.type === "request:retry")).toHaveLength(1);
});
