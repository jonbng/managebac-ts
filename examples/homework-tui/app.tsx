import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Task, TaskDetails, TaskView, UserProfile } from "../../src/index.js";
import type { HomeworkDataSource } from "./data.js";

const palette = {
  canvas: "#0a0a0a",
  surface: "#111111",
  selected: "#262626",
  border: "#3a3a3a",
  faint: "#666666",
  muted: "#a3a3a3",
  text: "#f5f5f5",
  inverse: "#0a0a0a",
  danger: "#ff6b6b",
} as const;

const views: readonly TaskView[] = ["upcoming", "overdue", "past"];
type MobilePane = "list" | "details";
type CollectionState = Readonly<{ items: readonly Task[]; loading: boolean; error: string | null }>;

function initialCollections(): Record<TaskView, CollectionState> {
  return {
    upcoming: { items: [], loading: true, error: null },
    overdue: { items: [], loading: true, error: null },
    past: { items: [], loading: true, error: null },
  };
}

export interface HomeworkAppProps {
  readonly source: HomeworkDataSource;
  readonly initialView?: TaskView;
}

export function HomeworkApp({ source, initialView = "upcoming" }: HomeworkAppProps) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [view, setView] = useState<TaskView>(initialView);
  const [collections, setCollections] = useState(initialCollections);
  const [selection, setSelection] = useState<Record<TaskView, number>>({ upcoming: 0, overdue: 0, past: 0 });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [details, setDetails] = useState<TaskDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const detailsCache = useRef(new Map<string, TaskDetails>());
  const compact = width < 96;

  useEffect(() => {
    const controller = new AbortController();
    detailsCache.current.clear();
    setDetails(null);
    setDetailError(null);
    setCollections((current) => ({
      upcoming: { ...current.upcoming, loading: true, error: null },
      overdue: { ...current.overdue, loading: true, error: null },
      past: { ...current.past, loading: true, error: null },
    }));

    void source.getProfile(controller.signal).then(setProfile, () => undefined);
    for (const taskView of views) {
      void source.list(taskView, controller.signal).then(
        (items) => setCollections((current) => ({ ...current, [taskView]: { items, loading: false, error: null } })),
        (reason: unknown) => {
          if (controller.signal.aborted) return;
          setCollections((current) => ({
            ...current,
            [taskView]: { ...current[taskView], loading: false, error: errorMessage(reason) },
          }));
        },
      );
    }

    return () => controller.abort();
  }, [reload, source]);

  const collection = collections[view];
  const selectedIndex = Math.min(selection[view], Math.max(0, collection.items.length - 1));
  const selected = collection.items[selectedIndex] ?? null;

  useEffect(() => {
    if (!selected) {
      setDetailLoading(false);
      return;
    }

    const cached = detailsCache.current.get(selected.key);
    if (cached) {
      setDetails(cached);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    void source.getDetails(selected, controller.signal).then(
      (value) => {
        detailsCache.current.set(value.key, value);
        setDetails(value);
        setDetailLoading(false);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setDetailError(errorMessage(reason));
        setDetailLoading(false);
      },
    );

    return () => controller.abort();
  }, [selected, source]);

  useKeyboard((key) => {
    if (key.name === "q") renderer.destroy();
    else if (key.name === "escape") {
      if (compact && mobilePane === "details") setMobilePane("list");
      else renderer.destroy();
    } else if (key.name === "j" || key.name === "down") {
      setSelection((current) => ({
        ...current,
        [view]: Math.max(0, Math.min(current[view] + 1, collection.items.length - 1)),
      }));
    } else if (key.name === "k" || key.name === "up") {
      setSelection((current) => ({ ...current, [view]: Math.max(0, current[view] - 1) }));
    } else if (key.name === "g" && key.shift) {
      setSelection((current) => ({ ...current, [view]: Math.max(0, collection.items.length - 1) }));
    } else if (key.name === "g") {
      setSelection((current) => ({ ...current, [view]: 0 }));
    } else if (compact && (key.name === "l" || key.name === "right" || key.name === "return")) {
      if (selected) setMobilePane("details");
    } else if (compact && (key.name === "h" || key.name === "left" || key.name === "backspace")) {
      setMobilePane("list");
    } else if (key.name === "r") setReload((value) => value + 1);
    else if (key.name === "1" || key.name === "2" || key.name === "3") {
      setView(views[Number(key.name) - 1]!);
      setMobilePane("list");
    } else if (key.name === "?") setShowHelp((value) => !value);
  });

  const visibleCount = Math.max(1, Math.floor((height - 15) / 2));
  const windowedTasks = useMemo(() => {
    const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), collection.items.length - visibleCount));
    return { start, items: collection.items.slice(start, start + visibleCount) };
  }, [collection.items, selectedIndex, visibleCount]);
  const resolvedDetails = details?.key === selected?.key ? details : null;
  const resolvingDetails = detailLoading || (!!selected && !resolvedDetails && !detailError);

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={palette.canvas}>
      <TopBar profile={profile} source={source.label} syncing={views.some((item) => collections[item].loading)} />
      <ViewTabs active={view} collections={collections} />

      <box flexGrow={1} paddingLeft={1} paddingRight={1}>
        {compact ? (
          mobilePane === "list" ? (
            <TaskList view={view} collection={collection} selectedIndex={selectedIndex} windowedTasks={windowedTasks} visibleCount={visibleCount} width="100%" />
          ) : (
            <DetailPanel task={selected} details={resolvedDetails} loading={resolvingDetails} error={detailError} width="100%" compact />
          )
        ) : (
          <box flexDirection="row" flexGrow={1} gap={1}>
            <TaskList view={view} collection={collection} selectedIndex={selectedIndex} windowedTasks={windowedTasks} visibleCount={visibleCount} width="52%" />
            <DetailPanel task={selected} details={resolvedDetails} loading={resolvingDetails} error={detailError} width="48%" />
          </box>
        )}
      </box>

      <StatusBar error={collection.items.length > 0 ? collection.error ?? detailError : null} compact={compact} mobilePane={mobilePane} showHelp={showHelp} />
    </box>
  );
}

function TopBar({ profile, source, syncing }: { profile: UserProfile | null; source: string; syncing: boolean }) {
  return (
    <box height={3} paddingLeft={2} paddingRight={2} flexDirection="row" alignItems="center" justifyContent="space-between">
      <text><strong fg={palette.text}>Study desk</strong><span fg={palette.faint}>  /  {profile?.programme ?? "ManageBac"}</span></text>
      <text fg={palette.muted} wrapMode="none">{profile?.name ?? source}  ·  {syncing ? "syncing" : "updated"}</text>
    </box>
  );
}

function ViewTabs({ active, collections }: { active: TaskView; collections: Record<TaskView, CollectionState> }) {
  return (
    <box height={2} paddingLeft={2} flexDirection="row" gap={1}>
      {views.map((view, index) => {
        const selected = active === view;
        const count = collections[view].loading && collections[view].items.length === 0 ? "—" : String(collections[view].items.length).padStart(2, "0");
        return (
          <box key={view} height={1} width={18} paddingLeft={1} backgroundColor={selected ? palette.text : palette.canvas}>
            <text fg={selected ? palette.inverse : view === "overdue" && collections.overdue.items.length > 0 ? palette.danger : palette.muted} attributes={selected ? TextAttributes.BOLD : 0}>
              {index + 1}  {titleCase(view).padEnd(9)} {count}
            </text>
          </box>
        );
      })}
    </box>
  );
}

function TaskList({ view, collection, selectedIndex, windowedTasks, visibleCount, width }: {
  view: TaskView;
  collection: CollectionState;
  selectedIndex: number;
  windowedTasks: Readonly<{ start: number; items: readonly Task[] }>;
  visibleCount: number;
  width: number | `${number}%`;
}) {
  return (
    <box width={width} flexShrink={0} flexGrow={1} border borderStyle="single" borderColor={palette.border} backgroundColor={palette.surface} flexDirection="column">
      <SectionTitle title={view === "overdue" ? "Needs attention" : view === "past" ? "Completed work" : "Coming up"} meta={collection.loading ? "syncing" : `${String(collection.items.length).padStart(2, "0")} tasks`} />
      <box height={1} paddingLeft={2} paddingRight={1} flexDirection="row">
        <text width={16} fg={palette.faint}>DUE / CLASS</text>
        <text fg={palette.faint}>TASK / STATUS</text>
      </box>
      {collection.error && collection.items.length === 0 ? (
        <Notice title="Could not load this view" detail={collection.error} danger />
      ) : collection.loading && collection.items.length === 0 ? (
        <TaskSkeleton count={visibleCount} />
      ) : collection.items.length === 0 ? (
        <Notice title="Nothing here" detail={`No ${view} assignments.`} />
      ) : (
        <>
          {windowedTasks.items.map((task, index) => (
            <TaskRow key={task.key} task={task} selected={windowedTasks.start + index === selectedIndex} overdue={view === "overdue"} />
          ))}
          <box flexGrow={1} />
          <text height={1} paddingLeft={2} fg={palette.faint}>{String(selectedIndex + 1).padStart(2, "0")} / {String(collection.items.length).padStart(2, "0")}</text>
        </>
      )}
    </box>
  );
}

function TaskRow({ task, selected, overdue }: { task: Task; selected: boolean; overdue: boolean }) {
  return (
    <box height={2} paddingLeft={1} paddingRight={1} flexDirection="row" backgroundColor={selected ? palette.selected : palette.surface}>
      <text width={2} fg={selected ? palette.text : palette.faint}>{selected ? "▌" : " "}</text>
      <box width={16} paddingRight={1} flexDirection="column">
        <text fg={overdue ? palette.danger : selected ? palette.text : palette.muted} wrapMode="none">{task.due.label ?? "No date"}</text>
        <text fg={palette.faint} wrapMode="none">{task.class.name ?? "Unknown class"}</text>
      </box>
      <box flexGrow={1} flexDirection="column">
        <text fg={selected ? palette.text : palette.muted} attributes={selected ? TextAttributes.BOLD : 0} wrapMode="none">{task.title}</text>
        <text fg={palette.faint} wrapMode="none">{[task.status, ...task.tags].filter(Boolean).join(" · ") || "Assignment"}</text>
      </box>
    </box>
  );
}

function DetailPanel({ task, details, loading, error, width, compact = false }: {
  task: Task | null;
  details: TaskDetails | null;
  loading: boolean;
  error: string | null;
  width: number | `${number}%`;
  compact?: boolean;
}) {
  return (
    <box width={width} flexGrow={1} border borderStyle="single" borderColor={palette.border} backgroundColor={palette.surface} flexDirection="column">
      <SectionTitle title={compact ? "←  Assignment" : "Assignment"} meta={loading ? "loading" : details ? "ready" : "preview"} />
      {!task ? (
        <Notice title="No selection" detail="Choose an assignment with j / k." />
      ) : (
        <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column">
          <text height={2} fg={palette.text} attributes={TextAttributes.BOLD} wrapMode="word">{task.title}</text>
          <text height={1} fg={palette.muted} wrapMode="none">{task.class.name ?? "Unknown class"}  ·  {task.due.label ?? "No due date"}</text>
          <box height={1} />
          <MetaRow
            label="SUBMISSION"
            value={loading ? "Loading…" : details?.submission.statusLabel ?? titleCase(details?.submission.status ?? "unknown")}
            muted={loading}
            danger={!!error || details?.submission.status === "not-submitted"}
          />
          <MetaRow label="TYPE" value={loading ? "Loading…" : details?.assessmentLabel ?? "Assignment"} muted={loading} />
          <MetaRow label="TEACHER" value={loading ? "Loading…" : details?.teacher?.name ?? "—"} muted={loading} />
          <MetaRow label="UNIT" value={loading ? "Loading…" : details?.unit?.name ?? "—"} muted={loading} />
          <MetaRow label="TAGS" value={task.tags.join(", ") || "—"} />
          <box height={1} />
          <box flexGrow={1}>
            <text fg={error ? palette.danger : loading ? palette.faint : palette.muted} wrapMode="word">
              {error ?? (loading ? "Fetching assignment details…" : details?.descriptionText ?? "No description was provided.")}
            </text>
          </box>
          <text height={1} fg={palette.faint}>ATTACHMENTS  {loading ? "—" : details?.attachments.length ?? 0}</text>
          {!loading && details?.attachments.slice(0, 2).map((attachment) => (
            <text key={attachment.key} height={1} fg={palette.muted} wrapMode="none">↳ {attachment.name}  {attachment.sizeLabel ?? ""}</text>
          ))}
        </box>
      )}
    </box>
  );
}

function SectionTitle({ title, meta }: { title: string; meta: string }) {
  return (
    <box height={3} paddingLeft={2} paddingRight={2} flexDirection="row" alignItems="center" justifyContent="space-between">
      <text fg={palette.text} attributes={TextAttributes.BOLD}>{title}</text>
      <text fg={palette.faint}>{meta.padStart(8, " ")}</text>
    </box>
  );
}

function MetaRow({ label, value, muted = false, danger = false }: { label: string; value: string; muted?: boolean; danger?: boolean }) {
  return <text height={1}><span fg={palette.faint}>{label.padEnd(10)}</span><span fg={danger ? palette.danger : muted ? palette.faint : palette.muted}>{value}</span></text>;
}

function TaskSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <box key={index} height={2} paddingLeft={3} flexDirection="column">
          <text fg={palette.border}>───────────     ─────────────────────────</text>
          <text fg={palette.border}>────────        ─────────────</text>
        </box>
      ))}
      <box flexGrow={1} />
      <text height={1} paddingLeft={2} fg={palette.faint}>— / —</text>
    </>
  );
}

function Notice({ title, detail, danger = false }: { title: string; detail: string; danger?: boolean }) {
  return (
    <box flexGrow={1} padding={2} alignItems="center" justifyContent="center" flexDirection="column">
      <text fg={danger ? palette.danger : palette.text} attributes={TextAttributes.BOLD}>{title}</text>
      <text fg={palette.faint} textAlign="center" wrapMode="word">{detail}</text>
    </box>
  );
}

function StatusBar({ error, compact, mobilePane, showHelp }: { error: string | null; compact: boolean; mobilePane: MobilePane; showHelp: boolean }) {
  let message = "j/k move   g/G first/last   1/2/3 views   r refresh   ? help   q quit";
  if (compact) message = mobilePane === "list" ? "j/k move   l/→ open   1/2/3 views   q quit" : "h/←/esc back   j/k move   q quit";
  if (showHelp) message = "Details preload automatically · due labels are preserved exactly as ManageBac displays them";
  return (
    <box height={2} paddingLeft={2} paddingRight={2} alignItems="center">
      <text fg={error ? palette.danger : palette.faint} wrapMode="none">{error ? `! ${error}` : message}</text>
    </box>
  );
}

function titleCase(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "An unknown error occurred.";
}
