import type { DashboardApi, TaskDto } from "./dashboardClient";

export function toggleTaskDone(api: DashboardApi, task: TaskDto, done: boolean) {
  void api.setTaskDone(task.id, done);
  for (const s of task.subtasks) {
    if (s.done !== done) void api.setSubtaskDone(s.id, done);
  }
}

export function toggleSubtaskDone(
  api: DashboardApi,
  task: TaskDto,
  subtaskId: number,
  done: boolean,
) {
  void api.setSubtaskDone(subtaskId, done);
  if (task.subtasks.length === 0) return;
  const allDone = task.subtasks.every((s) => (s.id === subtaskId ? done : s.done));
  if (allDone !== task.done) void api.setTaskDone(task.id, allDone);
}

/**
 * Moves one subtask to `toIndex` within its task's own ordered list, then
 * persists every subtask whose position actually shifted. There's no
 * `moveSubtask` endpoint (unlike tasks' `moveTask`), so positions are
 * reassigned client-side via plain `updateSubtask` calls.
 */
export function reorderSubtasks(
  api: DashboardApi,
  task: TaskDto,
  subtaskId: number,
  toIndex: number,
) {
  const ordered = [...task.subtasks].sort((a, b) => a.position - b.position);
  const fromIndex = ordered.findIndex((s) => s.id === subtaskId);
  if (fromIndex === -1 || fromIndex === toIndex) return;

  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);

  ordered.forEach((s, position) => {
    if (s.position !== position) void api.updateSubtask(s.id, { title: s.title, position });
  });
}
