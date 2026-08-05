// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleDialog } from "./ScheduleDialog";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => Promise.resolve(() => {}),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const initialStart = new Date(2026, 7, 1, 9, 0).getTime();
const initialEnd = new Date(2026, 7, 1, 10, 0).getTime();

describe("ScheduleDialog", () => {
  it("prefills start/end and asks before confirming", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ScheduleDialog
        open
        onOpenChange={onOpenChange}
        initialStart={initialStart}
        initialEnd={initialEnd}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByText("Schedule task")).not.toBeNull();
    const startInput = screen.getByLabelText("Start") as HTMLInputElement;
    const endInput = screen.getByLabelText("End") as HTMLInputElement;
    expect(startInput.value).toBe("2026-08-01T09:00");
    expect(endInput.value).toBe("2026-08-01T10:00");

    fireEvent.change(startInput, { target: { value: "2026-08-02T14:00" } });
    fireEvent.change(endInput, { target: { value: "2026-08-02T15:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [start, end] = onConfirm.mock.calls[0];
    expect(start).toBe(new Date(2026, 7, 2, 14, 0).getTime());
    expect(end).toBe(new Date(2026, 7, 2, 15, 30).getTime());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not confirm when end is before start", () => {
    const onConfirm = vi.fn();
    render(
      <ScheduleDialog
        open
        onOpenChange={vi.fn()}
        initialStart={initialStart}
        initialEnd={initialEnd}
        onConfirm={onConfirm}
      />,
    );

    const startInput = screen.getByLabelText("Start") as HTMLInputElement;
    const endInput = screen.getByLabelText("End") as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "2026-08-01T12:00" } });
    fireEvent.change(endInput, { target: { value: "2026-08-01T11:00" } });

    expect(screen.queryByText("End must be after start.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancel closes without confirming", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ScheduleDialog
        open
        onOpenChange={onOpenChange}
        initialStart={initialStart}
        initialEnd={initialEnd}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
