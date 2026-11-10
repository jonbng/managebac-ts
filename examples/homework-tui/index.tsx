import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { HomeworkApp } from "./app.js";
import { createDemoDataSource, createHomeworkDataSource } from "./data.js";

const source = process.argv.includes("--demo")
  ? createDemoDataSource()
  : createHomeworkDataSource(process.env);
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  backgroundColor: "#0a0a0a",
});

createRoot(renderer).render(<HomeworkApp source={source} />);
