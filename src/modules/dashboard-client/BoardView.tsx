import { useEffect, useRef, useState } from "react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BoardDto, DashboardApi, Snapshot } from "./lib/dashboardClient";
import { reorderSubtasks, toggleSubtaskDone, toggleTaskDone } from "./lib/subtaskCascade";
import { nextUnused } from "./lib/taskColors";
import { TaskCard } from "./TaskCard";

type Props = {
  snapshot: Snapshot;
  api: DashboardApi;
};

const DRAG_THRESHOLD_PX = 5;
const DONE_COLLAPSED_KEY = "terax.dashboard.doneCollapsed";

function loadDoneCollapsed(): Record<number, boolean> {
  try {
    const raw = localStorage.getItem(DONE_COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as Record<number, boolean>) : {};
  } catch {
    return {};
  }
}

type PendingDrag = {
  taskId: number;
  fromBoardId: number;
  startX: number;
  startY: number;
};

type HoverTarget = {
  boardId: number;
  index: number;
};

export function BoardView({ snapshot, api }: Props) {
  const [newBoardName, setNewBoardName] = useState("");
  const [addingTaskFor, setAddingTaskFor] = useState<number | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState<Record<number, boolean>>(loadDoneCollapsed);

  const toggleDoneCollapsed = (boardId: number, currentlyCollapsed: boolean) => {
    setDoneCollapsed((prev) => {
      const next = { ...prev, [boardId]: !currentlyCollapsed };
      localStorage.setItem(DONE_COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  const pendingRef = useRef<PendingDrag | null>(null);
  const draggingRef = useRef(false);
  const hoverRef = useRef<HoverTarget | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const boards = [...snapshot.boards].sort((a, b) => a.position - b.position);

  const activeTasksFor = (boardId: number) =>
    snapshot.tasks
      .filter((t) => t.boardId === boardId && !t.done)
      .sort((a, b) => a.position - b.position);

  const doneTasksFor = (boardId: number) =>
    snapshot.tasks
      .filter((t) => t.boardId === boardId && t.done)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const submitNewBoard = () => {
    const name = newBoardName.trim();
    if (!name) return;
    const color = nextUnused(boards.map((b) => b.colorArgb));
    void api.createBoard(name, color);
    setNewBoardName("");
  };

  const submitNewTask = (boardId: number) => {
    const title = newTaskTitle.trim();
    if (!title) return;
    void api.createTask({ boardId, title });
    setNewTaskTitle("");
    setAddingTaskFor(null);
  };

  const finishDrag = () => {
    const pending = pendingRef.current;
    const wasDragging = draggingRef.current;
    const hoverTarget = hoverRef.current;
    pendingRef.current = null;
    draggingRef.current = false;
    hoverRef.current = null;
    setDraggingTaskId(null);
    setHover(null);
    document.body.style.cursor = "";

    if (!pending || !wasDragging || !hoverTarget) return;
    const { taskId, fromBoardId } = pending;
    let target = hoverTarget.index;
    if (fromBoardId === hoverTarget.boardId) {
      const tasks = snapshotRef.current.tasks
        .filter((t) => t.boardId === fromBoardId && !t.done)
        .sort((a, b) => a.position - b.position);
      const from = tasks.findIndex((t) => t.id === taskId);
      if (from !== -1 && target > from) target -= 1;
      if (from === target) return;
    }
    void api.moveTask(taskId, hoverTarget.boardId, target);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending) return;

      if (!draggingRef.current) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        draggingRef.current = true;
        setDraggingTaskId(pending.taskId);
        document.body.style.cursor = "grabbing";
      }

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const columnEl = el?.closest<HTMLElement>("[data-board-column]");
      if (!columnEl) {
        hoverRef.current = null;
        setHover(null);
        return;
      }
      const boardId = Number(columnEl.dataset.boardColumn);
      const rows = Array.from(
        columnEl.querySelectorAll<HTMLElement>("[data-task-row]"),
      );
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      const next = { boardId, index };
      hoverRef.current = next;
      setHover(next);
    };

    const onUp = () => finishDrag();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = (taskId: number, boardId: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pendingRef.current = {
      taskId,
      fromBoardId: boardId,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-3">
      {boards.map((board) => (
        <BoardColumn
          key={board.id}
          board={board}
          tasks={activeTasksFor(board.id)}
          doneTasks={doneTasksFor(board.id)}
          doneCollapsed={doneCollapsed[board.id] ?? true}
          onToggleDoneCollapsed={() =>
            toggleDoneCollapsed(board.id, doneCollapsed[board.id] ?? true)
          }
          onClearDone={() => {
            for (const t of doneTasksFor(board.id)) void api.deleteTask(t.id);
          }}
          boards={boards}
          api={api}
          addingTask={addingTaskFor === board.id}
          newTaskTitle={addingTaskFor === board.id ? newTaskTitle : ""}
          onStartAddTask={() => {
            setAddingTaskFor(board.id);
            setNewTaskTitle("");
          }}
          onChangeNewTaskTitle={setNewTaskTitle}
          onSubmitNewTask={() => submitNewTask(board.id)}
          onCancelAddTask={() => setAddingTaskFor(null)}
          draggingTaskId={draggingTaskId}
          onStartDrag={startDrag}
          hover={hover?.boardId === board.id ? hover : null}
        />
      ))}
      <div className="w-64 shrink-0">
        <div className="flex gap-1.5">
          <Input
            value={newBoardName}
            placeholder="New board…"
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNewBoard()}
            className="h-8"
          />
          <Button size="sm" className="h-8" onClick={submitNewBoard}>
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function BoardColumn({
  board,
  tasks,
  doneTasks,
  doneCollapsed,
  onToggleDoneCollapsed,
  onClearDone,
  boards,
  api,
  addingTask,
  newTaskTitle,
  onStartAddTask,
  onChangeNewTaskTitle,
  onSubmitNewTask,
  onCancelAddTask,
  draggingTaskId,
  onStartDrag,
  hover,
}: {
  board: BoardDto;
  tasks: Snapshot["tasks"];
  doneTasks: Snapshot["tasks"];
  doneCollapsed: boolean;
  onToggleDoneCollapsed: () => void;
  onClearDone: () => void;
  boards: BoardDto[];
  api: DashboardApi;
  addingTask: boolean;
  newTaskTitle: string;
  onStartAddTask: () => void;
  onChangeNewTaskTitle: (v: string) => void;
  onSubmitNewTask: () => void;
  onCancelAddTask: () => void;
  draggingTaskId: number | null;
  onStartDrag: (taskId: number, boardId: number, e: React.PointerEvent) => void;
  hover: HoverTarget | null;
}) {
  const dropLine = <div className="h-0.5 shrink-0 rounded-full bg-primary" />;

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-sm font-medium">{board.name}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{tasks.length}</span>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            onClick={() => void api.deleteBoard(board.id)}
            title="Delete board"
          >
            <HugeiconsIcon icon={Delete02Icon} size={13} />
          </button>
        </div>
      </div>
      <div
        data-board-column={board.id}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
      >
        {tasks.map((task, i) => (
          <div
            key={task.id}
            data-task-row
            className={cn(
              "flex flex-col gap-1.5",
              draggingTaskId === task.id && "opacity-40",
            )}
          >
            {hover?.index === i && dropLine}
            <TaskCard
              task={task}
              boards={boards}
              onDragHandlePointerDown={(e) => onStartDrag(task.id, board.id, e)}
              onToggleDone={(done) => toggleTaskDone(api, task, done)}
              onSaveTitle={(title) =>
                void api.updateTask(task.id, {
                  title,
                  notes: task.notes,
                  colorArgb: task.colorArgb,
                  position: task.position,
                  startTime: task.startTime,
                  endTime: task.endTime,
                  durationMin: task.durationMin,
                  recurrenceRule: task.recurrenceRule,
                })
              }
              onSaveNotes={(notes) =>
                void api.updateTask(task.id, {
                  title: task.title,
                  notes,
                  colorArgb: task.colorArgb,
                  position: task.position,
                  startTime: task.startTime,
                  endTime: task.endTime,
                  durationMin: task.durationMin,
                  recurrenceRule: task.recurrenceRule,
                })
              }
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
          </div>
        ))}
        {hover?.index === tasks.length && dropLine}
        {addingTask ? (
          <Input
            autoFocus
            value={newTaskTitle}
            placeholder="Task title…"
            onChange={(e) => onChangeNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitNewTask();
              if (e.key === "Escape") onCancelAddTask();
            }}
            onBlur={onCancelAddTask}
            className="h-8"
          />
        ) : (
          <button
            className="flex items-center gap-1 rounded-md p-1.5 text-xs text-muted-foreground hover:bg-accent"
            onClick={onStartAddTask}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} />
            Add task
          </button>
        )}

        {doneTasks.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
            <div className="flex items-center justify-between gap-2">
              <button
                className="flex items-center gap-1 rounded-md p-1 text-xs text-muted-foreground hover:bg-accent"
                onClick={onToggleDoneCollapsed}
              >
                <HugeiconsIcon
                  icon={doneCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
                  size={13}
                />
                Done ({doneTasks.length})
              </button>
              {!doneCollapsed && (
                <button
                  className="rounded p-1 text-xs text-muted-foreground hover:bg-accent"
                  onClick={onClearDone}
                  title="Delete all done tasks"
                >
                  Clear
                </button>
              )}
            </div>
            {!doneCollapsed &&
              doneTasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-1.5 opacity-70">
                  <TaskCard
                    task={task}
                    boards={boards}
                    onDragHandlePointerDown={() => {}}
                    onToggleDone={(done) => toggleTaskDone(api, task, done)}
                    onSaveTitle={(title) =>
                      void api.updateTask(task.id, {
                        title,
                        notes: task.notes,
                        colorArgb: task.colorArgb,
                        position: task.position,
                        startTime: task.startTime,
                        endTime: task.endTime,
                        durationMin: task.durationMin,
                        recurrenceRule: task.recurrenceRule,
                      })
                    }
                    onSaveNotes={(notes) =>
                      void api.updateTask(task.id, {
                        title: task.title,
                        notes,
                        colorArgb: task.colorArgb,
                        position: task.position,
                        startTime: task.startTime,
                        endTime: task.endTime,
                        durationMin: task.durationMin,
                        recurrenceRule: task.recurrenceRule,
                      })
                    }
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
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
