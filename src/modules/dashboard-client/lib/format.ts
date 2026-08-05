export function formatDayHeading(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTimeRange(start: number, end: number | null): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const s = new Date(start).toLocaleTimeString(undefined, opts);
  if (!end) return s;
  const e = new Date(end).toLocaleTimeString(undefined, opts);
  return `${s} – ${e}`;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** ARGB int (as stored by the Android app) -> CSS hex, dropping alpha. */
export function argbToCss(argb: number | null | undefined): string | undefined {
  if (argb == null) return undefined;
  const rgb = argb & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}
