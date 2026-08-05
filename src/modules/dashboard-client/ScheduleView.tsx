import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DashboardApi, Snapshot, TaskDto } from "./lib/dashboardClient";
import { dayKey, formatDayHeading, formatTimeRange } from "./lib/format";
import { reorderSubtasks, toggleSubtaskDone, toggleTaskDone } from "./lib/subtaskCascade";
import { TaskCard } from "./TaskCard";

type Props = {
  snapshot: Snapshot;
  api: DashboardApi;
};

const updatePatch = (task: TaskDto) => ({
  title: task.title,
  notes: task.notes,
  colorArgb: task.colorArgb,
  position: task.position,
  startTime: task.startTime,
  endTime: task.endTime,
  durationMin: task.durationMin,
  recurrenceRule: task.recurrenceRule,
});

export function ScheduleView({ snapshot, api }: Props) {
  const boards = snapshot.boards;
  const boardName = (id: number) => boards.find((b) => b.id === id)?.name ?? "";

  const scheduled = snapshot.tasks
    .filter((t): t is TaskDto & { startTime: number } => t.startTime !== null)
    .sort((a, b) => a.startTime - b.startTime);

  const unscheduled = snapshot.tasks
    .filter((t) => t.startTime === null && !t.done)
    .sort((a, b) => a.position - b.position);

  const groups = new Map<string, { heading: string; tasks: typeof scheduled }>();
  for (const task of scheduled) {
    const key = dayKey(task.startTime);
    const g = groups.get(key);
    if (g) g.tasks.push(task);
    else groups.set(key, { heading: formatDayHeading(task.startTime), tasks: [task] });
  }

  const renderCard = (task: TaskDto) => (
    <TaskCard
      key={task.id}
      task={task}
      boards={boards}
      onToggleDone={(done) => toggleTaskDone(api, task, done)}
      onSaveTitle={(title) => void api.updateTask(task.id, { ...updatePatch(task), title })}
      onSaveNotes={(notes) => void api.updateTask(task.id, { ...updatePatch(task), notes })}
      onDelete={() => void api.deleteTask(task.id)}
      onMove={(boardId) => void api.moveTask(task.id, boardId, 0)}
      onSchedule={(start, end) => void api.scheduleTask(task.id, start, end)}
      onUnschedule={() => void api.scheduleTask(task.id, null, null)}
      onCreateSubtask={(title) => void api.createSubtask(task.id, title)}
      onToggleSubtask={(id, done) => toggleSubtaskDone(api, task, id, done)}
      onSaveSubtaskTitle={(id, title) => {
        const subtask = task.subtasks.find((s) => s.id === id);
        if (!subtask) return;
        void api.updateSubtask(id, { title, position: subtask.position });
      }}
      onDeleteSubtask={(id) => void api.deleteSubtask(id)}
      onReorderSubtask={(id, toIndex) => reorderSubtasks(api, task, id, toIndex)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      {[...groups.entries()]
        .sort(([, a], [, b]) => a.tasks[0].startTime - b.tasks[0].startTime)
        .map(([key, group]) => (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2 text-sm font-medium">
              {group.heading}
            </div>
            {group.tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-3">
                <span className="mt-2 w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatTimeRange(task.startTime, task.endTime)}
                </span>
                <div className="min-w-0 flex-1">
                  {renderCard(task)}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {boardName(task.boardId)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}

      {unscheduled.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="text-sm font-medium text-muted-foreground">Unscheduled</div>
          {unscheduled.map((task) => (
            <div key={task.id} className="flex items-start gap-3">
              <button
                className="mt-2 flex w-24 shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const start = Date.now();
                  void api.scheduleTask(task.id, start, start + 3_600_000);
                }}
              >
                <HugeiconsIcon icon={PlusSignIcon} size={12} />
                Schedule
              </button>
              <div className="min-w-0 flex-1">{renderCard(task)}</div>
            </div>
          ))}
        </div>
      )}

      {scheduled.length === 0 && unscheduled.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No tasks yet.
        </div>
      )}
    </div>
  );
}
