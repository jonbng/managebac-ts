import { ManageBacClient } from "../../src/index.js";
import type { EntityId, EntityKey, Task, TaskDetails, TaskView, UserProfile } from "../../src/index.js";

export interface HomeworkDataSource {
  readonly label: string;
  getProfile(signal: AbortSignal): Promise<UserProfile>;
  list(view: TaskView, signal: AbortSignal): Promise<readonly Task[]>;
  getDetails(task: Task, signal: AbortSignal): Promise<TaskDetails>;
}

export function createHomeworkDataSource(env: NodeJS.ProcessEnv): HomeworkDataSource {
  const domain = env["MANAGEBAC_DOMAIN"];
  const username = env["MANAGEBAC_USERNAME"];
  const password = env["MANAGEBAC_PASSWORD"];
  const configured = [domain, username, password].filter(Boolean).length;

  if (configured === 0) return createDemoDataSource();
  if (configured !== 3) {
    throw new Error(
      "Set all three of MANAGEBAC_DOMAIN, MANAGEBAC_USERNAME, and MANAGEBAC_PASSWORD, or unset all three for demo mode.",
    );
  }

  const client = new ManageBacClient({
    domain: domain!,
    username: username!,
    password: password!,
    cache: { ttlMs: 30_000, maxEntries: 100 },
    rateLimit: { maxConcurrent: 2, minIntervalMs: 100 },
  });

  return {
    label: domain!,
    getProfile: (signal) => client.me.get({ signal }),
    list: (view, signal) => client.tasks.list({ view, signal }),
    getDetails: (task, signal) =>
      client.classes.byId(task.class.id).tasks.byId(task.id).get({ signal }),
  };
}

const domain = "demo.managebac.com";

function task(
  id: string,
  title: string,
  className: string,
  due: string,
  tags: readonly string[],
  status: string | null = null,
): Task {
  const classId = className.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  return {
    kind: "task",
    id: id as EntityId<"task">,
    key: `managebac://${domain}/task/${id}` as Task["key"],
    source: { provider: "managebac", domain },
    title,
    url: `https://${domain}/student/homework/${id}`,
    class: {
      kind: "class",
      id: classId as EntityId<"class">,
      key: `managebac://${domain}/class/${classId}` as Task["class"]["key"],
      source: { provider: "managebac", domain },
      name: className,
      url: `https://${domain}/student/classes/${classId}`,
    },
    due: { label: due, at: null, precision: null },
    tags,
    status,
  };
}

const demoTasks = {
  upcoming: [
    task("1042", "Comparative essay: The Handmaid's Tale", "English A", "Tomorrow, 09:00", ["Summative"]),
    task("1043", "Integration by parts problem set", "Mathematics AA", "Friday, 15:30", ["Practice"]),
    task("1044", "Fieldwork reflection", "Geography", "Monday, 08:00", ["Criterion D"]),
    task("1045", "Read chapter 7 and annotate", "English A", "Tue, 29 Sep", ["Reading"], "In progress"),
    task("1046", "Redox titration lab report", "Chemistry", "Wed, 30 Sep", ["Lab", "Summative"]),
    task("1047", "CAS monthly reflection", "Core", "Thu, 1 Oct", ["CAS"]),
    task("1048", "Cold War source evaluation", "History", "Fri, 2 Oct", ["OPVL"]),
  ],
  overdue: [
    task("1038", "Vectors mixed review", "Mathematics AA", "Yesterday, 16:00", ["Practice"], "Overdue"),
    task("1035", "Knowledge question journal", "Theory of Knowledge", "Mon, 21 Sep", ["Reflection"], "Overdue"),
  ],
  past: [
    task("1031", "Organic chemistry quiz", "Chemistry", "Fri, 18 Sep", ["Quiz"], "Submitted"),
    task("1029", "Population case study", "Geography", "Wed, 16 Sep", ["Criterion A"], "Submitted"),
    task("1025", "Paper 1 guided analysis", "English A", "Fri, 11 Sep", ["Formative"], "Submitted"),
  ],
} satisfies Record<TaskView, readonly Task[]>;

export function createDemoDataSource(latencyMs = 180): HomeworkDataSource {
  return {
    label: "demo data",
    async getProfile(signal) {
      await delay(latencyMs, signal);
      return {
        kind: "user",
        id: "demo-student" as EntityId<"user">,
        key: `managebac://${domain}/user/demo-student` as EntityKey<"user">,
        source: { provider: "managebac", domain },
        name: "Alex Morgan",
        role: "student",
        roleLabel: "Student",
        programme: "IB Diploma Programme",
        url: `https://${domain}/student/profile`,
      };
    },
    async list(view, signal) {
      await delay(latencyMs, signal);
      return demoTasks[view];
    },
    async getDetails(selected, signal) {
      await delay(latencyMs, signal);
      return {
        ...selected,
        descriptionText:
          selected.id === "1042"
            ? "Write 1,200–1,500 words comparing how power is created and resisted. Use at least three close textual references and include a short reflection on your drafting choices."
            : "Review the task instructions in ManageBac, complete each required section, and check your work against the attached rubric before submitting.",
        teacher: {
          kind: "teacher",
          id: null,
          key: null,
          source: selected.source,
          name: "Demo Teacher",
          url: null,
        },
        submission: {
          status: selected.status === "Submitted" ? "submitted" : selected.status === "Overdue" ? "not-submitted" : "unknown",
          statusLabel: selected.status,
          submittedAt: null,
          feedbackText: null,
        },
        assessmentLabel: selected.tags.includes("Summative") ? "Summative assessment" : "Learning task",
        unit: {
          kind: "unit",
          id: "demo-unit" as EntityId<"unit">,
          key: `managebac://${domain}/unit/demo-unit` as EntityKey<"unit">,
          source: selected.source,
          name: selected.class.name === "English A" ? "Dystopia and resistance" : "Current unit",
          url: `https://${domain}/student/units/demo-unit`,
        },
        attachments: selected.tags.includes("Summative")
          ? [
              {
                kind: "attachment",
                id: "rubric" as EntityId<"attachment">,
                key: `managebac://${domain}/attachment/rubric` as TaskDetails["attachments"][number]["key"],
                source: selected.source,
                name: "Assessment rubric.pdf",
                sizeLabel: "184 KB",
                url: `https://${domain}/attachments/rubric`,
              },
            ]
          : [],
      } as TaskDetails;
    },
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
