import { describe, expect, it } from "vitest";
import { countdownTargetsFor, formatCountdown } from "./countdown";
import type { TaskDto } from "./dashboardClient";

function task(overrides: Partial<TaskDto> & { id: number }): TaskDto {
  return {
    boardId: 1,
    title: `task-${overrides.id}`,
    notes: "",
    colorArgb: null,
    position: 0,
    startTime: null,
    endTime: null,
    durationMin: null,
    done: false,
    recurrenceRule: null,
    createdAt: 0,
    completedAt: null,
    subtasks: [],
    ...overrides,
  };
}

describe("countdownTargetsFor", () => {
  it("returns current tasks targeting their endTime", () => {
    const t = task({ id: 1, startTime: 1000, endTime: 5000 });
    expect(countdownTargetsFor({ current: [t], upcoming: [], overdue: [] })).toEqual([
      { taskId: 1, kind: "current", targetAt: 5000 },
    ]);
  });

  it("returns upcoming tasks targeting their startTime", () => {
    const t = task({ id: 2, startTime: 9000, endTime: 12000 });
    expect(countdownTargetsFor({ current: [], upcoming: [t], overdue: [] })).toEqual([
      { taskId: 2, kind: "upcoming", targetAt: 9000 },
    ]);
  });

  it("returns overdue tasks with an endTime targeting that endTime", () => {
    const t = task({ id: 3, startTime: 1000, endTime: 2000 });
    expect(countdownTargetsFor({ current: [], upcoming: [], overdue: [t] })).toEqual([
      { taskId: 3, kind: "overdue", targetAt: 2000 },
    ]);
  });

  it("returns overdue tasks with no endTime targeting their startTime", () => {
    const t = task({ id: 4, startTime: 1000, endTime: null });
    expect(countdownTargetsFor({ current: [], upcoming: [], overdue: [t] })).toEqual([
      { taskId: 4, kind: "overdue", targetAt: 1000 },
    ]);
  });

  it("returns current, then upcoming, then overdue targets, preserving each array's order", () => {
    const c1 = task({ id: 1, startTime: 0, endTime: 1000 });
    const c2 = task({ id: 2, startTime: 0, endTime: 2000 });
    const u1 = task({ id: 3, startTime: 3000, endTime: 4000 });
    const u2 = task({ id: 4, startTime: 5000, endTime: 6000 });
    const o1 = task({ id: 5, startTime: -2000, endTime: -1000 });
    const o2 = task({ id: 6, startTime: -3000, endTime: -2500 });
    expect(
      countdownTargetsFor({ current: [c1, c2], upcoming: [u1, u2], overdue: [o1, o2] }),
    ).toEqual([
      { taskId: 1, kind: "current", targetAt: 1000 },
      { taskId: 2, kind: "current", targetAt: 2000 },
      { taskId: 3, kind: "upcoming", targetAt: 3000 },
      { taskId: 4, kind: "upcoming", targetAt: 5000 },
      { taskId: 5, kind: "overdue", targetAt: -1000 },
      { taskId: 6, kind: "overdue", targetAt: -2500 },
    ]);
  });

  it("returns an empty array when all groups are empty", () => {
    expect(countdownTargetsFor({ current: [], upcoming: [], overdue: [] })).toEqual([]);
  });
});

describe("formatCountdown", () => {
  it("formats zero as 00:00", () => {
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("clamps negative durations to 00:00", () => {
    expect(formatCountdown(-5000)).toBe("00:00");
  });

  it("floors partial seconds instead of rounding", () => {
    expect(formatCountdown(59_999)).toBe("00:59");
  });

  it("formats exactly one minute as 01:00", () => {
    expect(formatCountdown(60_000)).toBe("01:00");
  });

  it("formats under an hour as mm:ss", () => {
    expect(formatCountdown(45 * 60_000 + 12_000)).toBe("45:12");
  });

  it("formats exactly one hour as h:mm:ss with no leading zero on hours", () => {
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
  });

  it("formats multi-hour durations as h:mm:ss", () => {
    expect(formatCountdown(2 * 3_600_000 + 2 * 60_000 + 5_000)).toBe("2:02:05");
  });

  it("formats one hour, one minute, one second", () => {
    expect(formatCountdown(3_600_000 + 60_000 + 1_000)).toBe("1:01:01");
  });
});
