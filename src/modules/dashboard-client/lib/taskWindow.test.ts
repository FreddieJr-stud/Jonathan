import { describe, expect, it } from "vitest";
import { pickDotColor, pickTaskWindow } from "./taskWindow";
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

const MIN = 60_000;

describe("pickTaskWindow", () => {
  const now = 1_000_000;

  it("returns empty arrays when nothing is scheduled", () => {
    expect(pickTaskWindow([task({ id: 1 })], now)).toEqual({
      current: [],
      upcoming: [],
      overdue: [],
    });
  });

  it("puts a task whose window contains now into current", () => {
    const inWindow = task({ id: 1, startTime: now - MIN, endTime: now + MIN });
    const result = pickTaskWindow([inWindow], now);
    expect(result).toEqual({ current: [inWindow], upcoming: [], overdue: [] });
  });

  it("puts a task starting within the default 30-minute window into upcoming", () => {
    const soon = task({ id: 1, startTime: now + 10 * MIN, endTime: now + 40 * MIN });
    const result = pickTaskWindow([soon], now);
    expect(result).toEqual({ current: [], upcoming: [soon], overdue: [] });
  });

  it("excludes a task starting beyond the 30-minute window", () => {
    const far = task({ id: 1, startTime: now + 31 * MIN, endTime: now + 60 * MIN });
    expect(pickTaskWindow([far], now)).toEqual({ current: [], upcoming: [], overdue: [] });
  });

  it("includes a task starting exactly at the 30-minute boundary (inclusive)", () => {
    const boundary = task({ id: 1, startTime: now + 30 * MIN, endTime: now + 60 * MIN });
    const result = pickTaskWindow([boundary], now);
    expect(result.upcoming).toEqual([boundary]);
  });

  it("treats startTime === now with endTime >= now as current, not upcoming", () => {
    const startingNow = task({ id: 1, startTime: now, endTime: now + MIN });
    const result = pickTaskWindow([startingNow], now);
    expect(result).toEqual({ current: [startingNow], upcoming: [], overdue: [] });
  });

  it("surfaces both current and upcoming simultaneously (the 11:00/11:30 example)", () => {
    const runningNow = task({ id: 1, startTime: now, endTime: now + 60 * MIN });
    const startsIn30 = task({ id: 2, startTime: now + 30 * MIN, endTime: now + 180 * MIN });
    const result = pickTaskWindow([startsIn30, runningNow], now);
    expect(result).toEqual({ current: [runningNow], upcoming: [startsIn30], overdue: [] });
  });

  it("sorts current tasks by startTime ascending, ties by id ascending", () => {
    const a = task({ id: 2, startTime: now - 2000, endTime: now + 1000 });
    const b = task({ id: 1, startTime: now - 2000, endTime: now + 2000 });
    const c = task({ id: 3, startTime: now - 500, endTime: now + 500 });
    const result = pickTaskWindow([c, a, b], now);
    expect(result.current).toEqual([b, a, c]);
  });

  it("sorts upcoming tasks by startTime ascending, ties by id ascending", () => {
    const a = task({ id: 2, startTime: now + 1000, endTime: now + 2000 });
    const b = task({ id: 1, startTime: now + 1000, endTime: now + 1500 });
    const c = task({ id: 3, startTime: now + 5000, endTime: now + 6000 });
    const result = pickTaskWindow([c, a, b], now);
    expect(result.upcoming).toEqual([b, a, c]);
  });

  it("ignores done tasks for both current and upcoming", () => {
    const doneNow = task({ id: 1, startTime: now - MIN, endTime: now + MIN, done: true });
    const doneSoon = task({ id: 2, startTime: now + MIN, endTime: now + 2 * MIN, done: true });
    expect(pickTaskWindow([doneNow, doneSoon], now)).toEqual({
      current: [],
      upcoming: [],
      overdue: [],
    });
  });

  it("ignores unscheduled tasks (null startTime or endTime)", () => {
    const noStart = task({ id: 1, startTime: null, endTime: now + MIN });
    const noEnd = task({ id: 2, startTime: now - MIN, endTime: null });
    // noEnd has startTime in the past with no endTime, so it lands in overdue, not current/upcoming.
    expect(pickTaskWindow([noStart, noEnd], now)).toEqual({
      current: [],
      upcoming: [],
      overdue: [noEnd],
    });
  });

  it("a task with startTime set but null endTime can still be upcoming", () => {
    const soonNoEnd = task({ id: 1, startTime: now + 5 * MIN, endTime: null });
    expect(pickTaskWindow([soonNoEnd], now)).toEqual({
      current: [],
      upcoming: [soonNoEnd],
      overdue: [],
    });
  });

  it("respects a custom upcomingWindowMs, including zero (upcoming always empty)", () => {
    const soon = task({ id: 1, startTime: now + 5 * MIN, endTime: now + 10 * MIN });
    expect(pickTaskWindow([soon], now, 0)).toEqual({ current: [], upcoming: [], overdue: [] });
    expect(pickTaskWindow([soon], now, 10 * MIN)).toEqual({
      current: [],
      upcoming: [soon],
      overdue: [],
    });
  });

  it("puts a task whose endTime has passed into overdue", () => {
    const missed = task({ id: 1, startTime: now - 2 * MIN, endTime: now - MIN });
    expect(pickTaskWindow([missed], now)).toEqual({ current: [], upcoming: [], overdue: [missed] });
  });

  it("treats endTime === now as still current, not overdue (boundary)", () => {
    const endingNow = task({ id: 1, startTime: now - MIN, endTime: now });
    expect(pickTaskWindow([endingNow], now)).toEqual({
      current: [endingNow],
      upcoming: [],
      overdue: [],
    });
  });

  it("puts a task with a past startTime and no endTime into overdue", () => {
    const staleNoEnd = task({ id: 1, startTime: now - MIN, endTime: null });
    expect(pickTaskWindow([staleNoEnd], now)).toEqual({
      current: [],
      upcoming: [],
      overdue: [staleNoEnd],
    });
  });

  it("does not treat startTime === now with no endTime as overdue", () => {
    const rightNowNoEnd = task({ id: 1, startTime: now, endTime: null });
    expect(pickTaskWindow([rightNowNoEnd], now)).toEqual({
      current: [],
      upcoming: [],
      overdue: [],
    });
  });

  it("ignores done tasks for overdue", () => {
    const doneMissed = task({ id: 1, startTime: now - 2 * MIN, endTime: now - MIN, done: true });
    expect(pickTaskWindow([doneMissed], now)).toEqual({ current: [], upcoming: [], overdue: [] });
  });

  it("sorts overdue tasks by startTime ascending (oldest miss first), ties by id ascending", () => {
    const a = task({ id: 2, startTime: now - 5000, endTime: now - 4000 });
    const b = task({ id: 1, startTime: now - 5000, endTime: now - 3000 });
    const c = task({ id: 3, startTime: now - 1000, endTime: now - 500 });
    const result = pickTaskWindow([c, a, b], now);
    expect(result.overdue).toEqual([b, a, c]);
  });
});

describe("pickDotColor", () => {
  it("is red when there is at least one current task", () => {
    expect(pickDotColor({ current: [task({ id: 1 })], upcoming: [] })).toBe("red");
  });

  it("is yellow when there is no current task but an upcoming one exists", () => {
    expect(pickDotColor({ current: [], upcoming: [task({ id: 1 })] })).toBe("yellow");
  });

  it("is green when both are empty", () => {
    expect(pickDotColor({ current: [], upcoming: [] })).toBe("green");
  });

  it("stays red when both current and upcoming are non-empty", () => {
    expect(
      pickDotColor({ current: [task({ id: 1 })], upcoming: [task({ id: 2 })] }),
    ).toBe("red");
  });
});
