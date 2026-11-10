import { expect, test } from "bun:test";
import { ManageBacClient } from "../../src/index.js";

const { MANAGEBAC_DOMAIN, MANAGEBAC_USERNAME, MANAGEBAC_PASSWORD } = process.env;
const hasCredentials = Boolean(MANAGEBAC_DOMAIN && MANAGEBAC_USERNAME && MANAGEBAC_PASSWORD);

test.skipIf(!hasCredentials)("reads a complete upcoming-homework snapshot from ManageBac", async () => {
  const client = new ManageBacClient({
    domain: MANAGEBAC_DOMAIN!,
    username: MANAGEBAC_USERNAME!,
    password: MANAGEBAC_PASSWORD!,
  });
  const snapshot = await client.getUpcomingHomeworkSnapshot();

  expect(snapshot.completeness).toBe("complete");
  expect(snapshot.parserVersion).toBe("tasks-and-deadlines/v2");
  expect(new Set(snapshot.items.map((task) => task.key)).size).toBe(snapshot.items.length);
  for (const task of snapshot.items) {
    expect(task.id).toMatch(/^\d+$/);
    expect(task.key).toContain(`/task/${task.id}`);
    expect(task.title.length).toBeGreaterThan(0);
    expect(task.url).toStartWith(client.domain);
    expect(task.class.id).toMatch(/^\d+$/);
    expect(task.class.url).toStartWith(client.domain);
    expect(Array.isArray(task.tags)).toBe(true);
    expect(task.due.at === null || !Number.isNaN(Date.parse(task.due.at))).toBe(true);
  }

  const classes = await client.classes.list();
  expect(new Set(classes.map((item) => item.key)).size).toBe(classes.length);
  for (const item of classes) {
    expect(item.id).toMatch(/^\d+$/);
    expect(item.key).toContain(`/class/${item.id}`);
    expect(item.name.length).toBeGreaterThan(0);
  }

  const firstClass = classes[0];
  if (firstClass) {
    const classHomework = await client.classes.byId(firstClass.id).tasks.listUpcoming();
    expect(classHomework.every((task) => task.class.id === firstClass.id)).toBe(true);
    const units = await client.classes.byId(firstClass.id).units.list();
    expect(units.every((unit) => unit.class.id === firstClass.id)).toBe(true);

    const firstTask = classHomework[0];
    if (firstTask) {
      const details = await client.classes.byId(firstClass.id).tasks.byId(firstTask.id).get();
      expect(details.id).toBe(firstTask.id);
      expect(details.class.id).toBe(firstClass.id);
    }
  }

  const calendar = await client.calendar.snapshot({ start: "2026-09-01", end: "2026-10-01" });
  expect(calendar.timezone.length).toBeGreaterThan(0);
  expect(new Set(calendar.items.map((event) => event.key)).size).toBe(calendar.items.length);

  const profile = await client.me.get();
  expect(profile.id).toMatch(/^\d+$/);
  expect(profile.role).toBe("student");
}, 20_000);
