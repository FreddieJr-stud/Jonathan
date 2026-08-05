import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDashboardSyncStore } from "@/modules/dashboard-client";
import type { DashboardApi, TaskDto } from "@/modules/dashboard-client/lib/dashboardClient";
import { toggleSubtaskDone, toggleTaskDone } from "@/modules/dashboard-client/lib/subtaskCascade";
import { formatCountdown } from "@/modules/dashboard-client/lib/countdown";
import { pickDotColor, pickTaskWindow, type TaskWindowResult } from "@/modules/dashboard-client/lib/taskWindow";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  CheckmarkSquare02Icon,
  CopyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

const DOT_CLASS: Record<"red" | "yellow" | "green" | "neutral", string> = {
  red: "bg-red-500",
  yellow: "bg-amber-400",
  green: "bg-emerald-500",
  neutral: "bg-muted-foreground/40",
};

type GroupKind = "current" | "upcoming" | "overdue";

const COLLAPSED_GROUPS_KEY = "terax.taskTimer.collapsedGroups";
/** Now/Next start expanded; Overdue starts collapsed so it doesn't clutter by default. */
const DEFAULT_GROUP_COLLAPSED: Record<GroupKind, boolean> = {
  current: false,
  upcoming: false,
  overdue: true,
};

function loadCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function TaskTimerButton() {
  const snapshot = useDashboardSyncStore((s) => s.snapshot);
  const status = useDashboardSyncStore((s) => s.status);
  const api = useDashboardSyncStore((s) => s.api);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    loadCollapsedGroups,
  );
  const toggleGroupCollapsed = (kind: GroupKind) => {
    const currentlyCollapsed = collapsedGroups[kind] ?? DEFAULT_GROUP_COLLAPSED[kind];
    setCollapsedGroups((prev) => {
      const next = { ...prev, [kind]: !currentlyCollapsed };
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const connected = status === "open" && !!snapshot && !!api;
  const taskWindow: TaskWindowResult = connected
    ? pickTaskWindow(snapshot!.tasks, now)
    : { current: [], upcoming: [], overdue: [] };
  const dot = connected ? pickDotColor(taskWindow) : "neutral";

  const totalCount = taskWindow.current.length + taskWindow.upcoming.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title="Task timers"
          className="h-7 shrink-0 gap-1.5 rounded-md px-2 font-mono text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span className={cn("size-1.5 rounded-full", DOT_CLASS[dot])} />
          <HugeiconsIcon icon={CheckmarkSquare02Icon} size={14} strokeWidth={1.75} />
          {totalCount > 0 && <span>{totalCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        {!connected ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Not connected
          </div>
        ) : totalCount === 0 && taskWindow.overdue.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No tasks in the next 30 minutes
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            {taskWindow.current.length > 0 && (
              <TaskGroup
                label="Now"
                dotClass="bg-red-500"
                tasks={taskWindow.current}
                kind="current"
                now={now}
                api={api!}
                collapsed={collapsedGroups.current ?? DEFAULT_GROUP_COLLAPSED.current}
                onToggleCollapsed={() => toggleGroupCollapsed("current")}
              />
            )}
            {taskWindow.upcoming.length > 0 && (
              <TaskGroup
                label="Next"
                dotClass="bg-amber-400"
                tasks={taskWindow.upcoming}
                kind="upcoming"
                now={now}
                api={api!}
                collapsed={collapsedGroups.upcoming ?? DEFAULT_GROUP_COLLAPSED.upcoming}
                onToggleCollapsed={() => toggleGroupCollapsed("upcoming")}
              />
            )}
            {taskWindow.overdue.length > 0 && (
              <TaskGroup
                label="Overdue"
                dotClass="bg-muted-foreground/50"
                tasks={taskWindow.overdue}
                kind="overdue"
                now={now}
                api={api!}
                collapsed={collapsedGroups.overdue ?? DEFAULT_GROUP_COLLAPSED.overdue}
                onToggleCollapsed={() => toggleGroupCollapsed("overdue")}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TaskGroup({
  label,
  dotClass,
  tasks,
  kind,
  now,
  api,
  collapsed,
  onToggleCollapsed,
}: {
  label: string;
  dotClass: string;
  tasks: TaskDto[];
  kind: GroupKind;
  now: number;
  api: DashboardApi;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} size={12} />
        <span className={cn("size-1.5 rounded-full", dotClass)} />
        {label}
        {tasks.length > 1 && ` (${tasks.length})`}
      </button>
      {!collapsed &&
        tasks.map((task) => (
          <TaskSummaryCard key={task.id} task={task} api={api} kind={kind} now={now} />
        ))}
    </div>
  );
}

function TaskSummaryCard({
  task,
  api,
  kind,
  now,
}: {
  task: TaskDto;
  api: DashboardApi;
  kind: GroupKind;
  now: number;
}) {
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(false);
  const subtasks = [...task.subtasks].sort((a, b) => a.position - b.position);

  let timeLabel: string;
  if (kind === "current") {
    timeLabel = formatCountdown((task.endTime as number) - now);
  } else if (kind === "upcoming") {
    timeLabel = formatCountdown((task.startTime as number) - now);
  } else {
    const dueAt = task.endTime ?? (task.startTime as number);
    timeLabel = `${formatCountdown(now - dueAt)} ago`;
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="flex items-start gap-1.5">
        <Checkbox
          checked={task.done}
          onCheckedChange={(v) => toggleTaskDone(api, task, v === true)}
          className="mt-0.5 size-3.5 shrink-0"
        />
        <span
          className={cn(
            "flex-1 whitespace-normal break-words text-sm font-medium",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {timeLabel}
        </span>
        {subtasks.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={subtasksCollapsed ? "Show subtasks" : "Hide subtasks"}
            className="size-4 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setSubtasksCollapsed((v) => !v)}
          >
            <HugeiconsIcon
              icon={subtasksCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
              size={11}
            />
          </Button>
        )}
      </div>
      {subtasks.length > 0 && !subtasksCollapsed && (
        <div className="mt-1.5 ml-5 flex flex-col gap-1">
          {subtasks.map((s) => (
            <div key={s.id} className="flex items-start gap-1.5">
              <Checkbox
                checked={s.done}
                onCheckedChange={(v) => toggleSubtaskDone(api, task, s.id, v === true)}
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span
                className={cn(
                  "flex-1 whitespace-normal break-words text-xs",
                  s.done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {s.title}
              </span>
              <CopyButton text={s.title} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Copy"
      className="size-4 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <HugeiconsIcon
        icon={copied ? CheckmarkCircle01Icon : CopyIcon}
        size={11}
        strokeWidth={1.9}
      />
    </Button>
  );
}
