import type { Tab } from "./useTabs";

/**
 * The label shown on a tab. A user-set custom name wins for **any** kind
 * (display only — never renames the file/cwd). Otherwise terminal tabs fall
 * back to the last segment of the cwd, and every other kind uses its stored
 * title. Keeping this pure makes the "custom name survives a cd" invariant
 * testable without rendering the bar.
 */
export function labelFor(t: Tab): string {
  if (t.customTitle) return t.customTitle;
  if (t.kind !== "terminal") return t.title;
  if (!t.cwd) return t.title;
  const parts = t.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
