import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStart: number;
  initialEnd: number;
  onConfirm: (start: number, end: number) => void;
};

function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function ScheduleDialog({ open, onOpenChange, initialStart, initialEnd, onConfirm }: Props) {
  const [startValue, setStartValue] = useState(() => toLocalInputValue(initialStart));
  const [endValue, setEndValue] = useState(() => toLocalInputValue(initialEnd));

  const start = fromLocalInputValue(startValue);
  const end = fromLocalInputValue(endValue);
  const valid = start !== null && end !== null && end > start;

  const reset = () => {
    setStartValue(toLocalInputValue(initialStart));
    setEndValue(toLocalInputValue(initialEnd));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule task</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-start">Start</Label>
            <Input
              id="schedule-start"
              type="datetime-local"
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-end">End</Label>
            <Input
              id="schedule-end"
              type="datetime-local"
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
            />
          </div>
          {!valid && (
            <p className="text-xs text-destructive">End must be after start.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (!valid || start === null || end === null) return;
              onConfirm(start, end);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
