import type { TaskWindowResult } from "./taskWindow";

export type CountdownTarget = {
  taskId: number;
  kind: "current" | "upcoming" | "overdue";
  targetAt: number;
};

/**
 * Current tasks count down to their endTime; upcoming tasks to their
 * startTime; overdue tasks target the moment they became overdue (endTime,
 * or startTime if there's no endTime) — callers show elapsed-since, not
 * remaining.
 */
export function countdownTargetsFor(window: TaskWindowResult): CountdownTarget[] {
  return [
    ...window.current.map((t) => ({
      taskId: t.id,
      kind: "current" as const,
      targetAt: t.endTime as number,
    })),
    ...window.upcoming.map((t) => ({
      taskId: t.id,
      kind: "upcoming" as const,
      targetAt: t.startTime as number,
    })),
    ...window.overdue.map((t) => ({
      taskId: t.id,
      kind: "overdue" as const,
      targetAt: t.endTime ?? (t.startTime as number),
    })),
  ];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Floors to whole seconds; mm:ss under an hour, h:mm:ss (no leading zero on hours) at/above. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}
