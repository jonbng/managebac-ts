import { ManageBacClient } from "../src/index.js";

const { MANAGEBAC_DOMAIN, MANAGEBAC_USERNAME, MANAGEBAC_PASSWORD } = process.env;
if (!MANAGEBAC_DOMAIN || !MANAGEBAC_USERNAME || !MANAGEBAC_PASSWORD) {
  throw new Error("Set MANAGEBAC_DOMAIN, MANAGEBAC_USERNAME, and MANAGEBAC_PASSWORD in .env.");
}

const client = new ManageBacClient({
  domain: MANAGEBAC_DOMAIN,
  username: MANAGEBAC_USERNAME,
  password: MANAGEBAC_PASSWORD,
});

const homework = await client.tasks.listUpcoming();
const detailedHomework = await Promise.all(homework.map((task) =>
  client.classes.byId(task.class.id).tasks.byId(task.id).get()
));

console.table(detailedHomework.map((task) => ({
  id: task.id,
  due: task.due.label,
  dueAt: task.due.at,
  class: task.class.name,
  title: task.title,
  teacher: task.teacher?.name ?? "Unknown",
  description: task.descriptionText ?? "No description provided",
  submission: task.submission.status,
  status: task.status,
})));
