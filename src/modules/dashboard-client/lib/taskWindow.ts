import type { TaskDto } from "./dashboardClient";

export type TaskWindowResult = { current: TaskDto[]; upcoming: TaskDto[]; overdue: TaskDto[] };

function byStartThenId(a: TaskDto, b: TaskDto): number {
  return (a.startTime as number) - (b.startTime as number) || a.id - b.id;
}

/**
 * Splits tasks into those running right now, those starting within
 * `upcomingWindowMs` (default 30 minutes), and those whose scheduled time
 * has already passed without being marked done. Each group is computed with
 * its own independent filter — a task can't land in more than one.
 */
export function pickTaskWindow(
  tasks: TaskDto[],
  now: number,
  upcomingWindowMs = 1_800_000,
): TaskWindowResult {
  const current = tasks
    .filter(
      (t) =>
        !t.done &&
        t.startTime !== null &&
        t.endTime !== null &&
        t.startTime <= now &&
        now <= t.endTime,
    )
    .sort(byStartThenId);

  const upcoming = tasks
    .filter(
      (t) =>
        !t.done &&
        t.startTime !== null &&
        t.startTime > now &&
        t.startTime <= now + upcomingWindowMs,
    )
    .sort(byStartThenId);

  const overdue = tasks
    .filter(
      (t) =>
        !t.done &&
        t.startTime !== null &&
        (t.endTime !== null ? t.endTime < now : t.startTime < now),
    )
    .sort(byStartThenId);

  return { current, upcoming, overdue };
}

export type DotColor = "red" | "yellow" | "green";

/**
 * Red wins over yellow: a task in progress always takes priority. Overdue
 * tasks don't affect the dot — they're informational, not urgency signal.
 */
export function pickDotColor(window: { current: TaskDto[]; upcoming: TaskDto[] }): DotColor {
  if (window.current.length > 0) return "red";
  if (window.upcoming.length > 0) return "yellow";
  return "green";
}
