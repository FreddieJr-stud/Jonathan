import { useEffect, useRef, useState } from "react";
import {
  Calendar03Icon,
  Delete02Icon,
  Drag04Icon,
  MoreVerticalIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ScheduleDialog } from "./ScheduleDialog";
import type { BoardDto, SubtaskDto, TaskDto } from "./lib/dashboardClient";
import { argbToCss, formatTimeRange } from "./lib/format";

type Props = {
  task: TaskDto;
  boards: BoardDto[];
  onToggleDone: (done: boolean) => void;
  onSaveTitle: (title: string) => void;
  onSaveNotes: (notes: string) => void;
  onDelete: () => void;
  onMove: (boardId: number) => void;
  onSchedule: (start: number, end: number) => void;
  onUnschedule: () => void;
  onCreateSubtask: (title: string) => void;
  onToggleSubtask: (id: number, done: boolean) => void;
  onSaveSubtaskTitle: (id: number, title: string) => void;
  onDeleteSubtask: (id: number) => void;
  onReorderSubtask: (subtaskId: number, toIndex: number) => void;
  onDragHandlePointerDown?: (e: React.PointerEvent) => void;
};

const SUBTASK_DRAG_THRESHOLD_PX = 5;

type PendingSubtaskDrag = {
  subtaskId: number;
  startX: number;
  startY: number;
};

export function TaskCard({
  task,
  boards,
  onToggleDone,
  onSaveTitle,
  onSaveNotes,
  onDelete,
  onMove,
  onSchedule,
  onUnschedule,
  onCreateSubtask,
  onToggleSubtask,
  onSaveSubtaskTitle,
  onDeleteSubtask,
  onReorderSubtask,
  onDragHandlePointerDown,
}: Props) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [newSubtask, setNewSubtask] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const accent = argbToCss(task.colorArgb);
  const subtasks = [...task.subtasks].sort((a, b) => a.position - b.position);

  const submitNewSubtask = () => {
    const title = newSubtask.trim();
    if (!title) return;
    onCreateSubtask(title);
    setNewSubtask("");
  };

  const subtaskListRef = useRef<HTMLDivElement>(null);
  const pendingSubtaskDrag = useRef<PendingSubtaskDrag | null>(null);
  const subtaskDraggingRef = useRef(false);
  const subtaskHoverIndexRef = useRef<number | null>(null);
  const [draggingSubtaskId, setDraggingSubtaskId] = useState<number | null>(null);
  const [subtaskHoverIndex, setSubtaskHoverIndex] = useState<number | null>(null);
  // Mirrored every render (not read inside the mount-only effect's closure)
  // so the pointerup handler always calls the latest callback for the
  // latest task, the same staleness workaround BoardView uses for its drag.
  const onReorderSubtaskRef = useRef(onReorderSubtask);
  onReorderSubtaskRef.current = onReorderSubtask;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pending = pendingSubtaskDrag.current;
      if (!pending) return;

      if (!subtaskDraggingRef.current) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) < SUBTASK_DRAG_THRESHOLD_PX) return;
        subtaskDraggingRef.current = true;
        setDraggingSubtaskId(pending.subtaskId);
        document.body.style.cursor = "grabbing";
      }

      const container = subtaskListRef.current;
      if (!container) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !container.contains(el)) return;

      const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-subtask-row]"));
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      subtaskHoverIndexRef.current = index;
      setSubtaskHoverIndex(index);
    };

    const onUp = () => {
      const pending = pendingSubtaskDrag.current;
      const wasDragging = subtaskDraggingRef.current;
      const target = subtaskHoverIndexRef.current;
      pendingSubtaskDrag.current = null;
      subtaskDraggingRef.current = false;
      subtaskHoverIndexRef.current = null;
      setDraggingSubtaskId(null);
      setSubtaskHoverIndex(null);
      document.body.style.cursor = "";
      if (pending && wasDragging && target !== null) {
        onReorderSubtaskRef.current(pending.subtaskId, target);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSubtaskDrag = (subtaskId: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pendingSubtaskDrag.current = { subtaskId, startX: e.clientX, startY: e.clientY };
  };

  return (
    <div
      className={cn(
        "group rounded-md border border-border bg-card p-2 text-sm",
        task.done && "opacity-60",
      )}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      <div className="flex items-start gap-2">
        {onDragHandlePointerDown && (
          <button
            type="button"
            onPointerDown={onDragHandlePointerDown}
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 active:cursor-grabbing"
            title="Drag to move"
          >
            <HugeiconsIcon icon={Drag04Icon} size={13} />
          </button>
        )}
        <Checkbox
          checked={task.done}
          onCheckedChange={(v) => onToggleDone(v === true)}
          className="mt-0.5"
        />
        <textarea
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && onSaveTitle(title.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className={cn(
            "field-sizing-content mt-0.5 min-w-0 flex-1 resize-none bg-transparent text-sm outline-none",
            task.done && "line-through",
          )}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100">
              <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
              Schedule…
            </DropdownMenuItem>
            {task.startTime !== null && (
              <DropdownMenuItem onClick={onUnschedule}>Unschedule</DropdownMenuItem>
            )}
            {boards.length > 1 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to board</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {boards
                    .filter((b) => b.id !== task.boardId)
                    .map((b) => (
                      <DropdownMenuItem key={b.id} onClick={() => onMove(b.id)}>
                        {b.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-1.5 ml-6 flex flex-col gap-1.5">
        {task.startTime !== null && (
          <Badge variant="secondary" className="w-fit gap-1 text-[11px]">
            <HugeiconsIcon icon={Calendar03Icon} size={11} />
            {formatTimeRange(task.startTime, task.endTime)}
          </Badge>
        )}
        {(notes || task.startTime !== null) && (
          <Textarea
            value={notes}
            placeholder="Notes…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== task.notes && onSaveNotes(notes)}
            className="min-h-0 resize-none border-none bg-transparent p-0 text-xs text-muted-foreground shadow-none focus-visible:ring-0"
            rows={notes ? undefined : 1}
          />
        )}

        {subtasks.length > 0 && (
          <div ref={subtaskListRef} className="flex flex-col gap-0.5">
            {subtasks.map((s, i) => (
              <div key={s.id} data-subtask-row>
                {subtaskHoverIndex === i && (
                  <div className="mb-0.5 h-0.5 shrink-0 rounded-full bg-primary" />
                )}
                <SubtaskRow
                  subtask={s}
                  dragging={draggingSubtaskId === s.id}
                  onToggle={(done) => onToggleSubtask(s.id, done)}
                  onSaveTitle={(title) => onSaveSubtaskTitle(s.id, title)}
                  onDelete={() => onDeleteSubtask(s.id)}
                  onDragHandlePointerDown={(e) => startSubtaskDrag(s.id, e)}
                />
              </div>
            ))}
            {subtaskHoverIndex === subtasks.length && (
              <div className="h-0.5 shrink-0 rounded-full bg-primary" />
            )}
          </div>
        )}
        <div className="group/add flex items-center gap-1.5">
          <HugeiconsIcon
            icon={PlusSignIcon}
            size={11}
            className="shrink-0 text-muted-foreground"
          />
          <input
            value={newSubtask}
            placeholder="Add subtask…"
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNewSubtask()}
            onBlur={submitNewSubtask}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      </div>
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        initialStart={task.startTime ?? Date.now()}
        initialEnd={task.endTime ?? (task.startTime ?? Date.now()) + 3_600_000}
        onConfirm={onSchedule}
      />
    </div>
  );
}

function SubtaskRow({
  subtask,
  dragging,
  onToggle,
  onSaveTitle,
  onDelete,
  onDragHandlePointerDown,
}: {
  subtask: SubtaskDto;
  dragging: boolean;
  onToggle: (done: boolean) => void;
  onSaveTitle: (title: string) => void;
  onDelete: () => void;
  onDragHandlePointerDown: (e: React.PointerEvent) => void;
}) {
  const [title, setTitle] = useState(subtask.title);

  return (
    <div className={cn("group/subtask flex items-start gap-1.5", dragging && "opacity-40")}>
      <button
        type="button"
        onPointerDown={onDragHandlePointerDown}
        className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover/subtask:opacity-100 active:cursor-grabbing"
        title="Drag to reorder"
      >
        <HugeiconsIcon icon={Drag04Icon} size={11} />
      </button>
      <Checkbox
        checked={subtask.done}
        onCheckedChange={(v) => onToggle(v === true)}
        className="mt-0.5 size-3.5 shrink-0"
      />
      <textarea
        value={title}
        rows={1}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== subtask.title && onSaveTitle(title.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className={cn(
          "field-sizing-content min-w-0 flex-1 resize-none bg-transparent text-[11px] outline-none",
          subtask.done && "text-muted-foreground line-through",
        )}
      />
      <button
        type="button"
        onClick={onDelete}
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover/subtask:opacity-100"
        title="Delete subtask"
      >
        <HugeiconsIcon icon={Delete02Icon} size={11} />
      </button>
    </div>
  );
}
