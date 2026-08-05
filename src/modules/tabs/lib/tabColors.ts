import type { TabColor } from "./useTabs";

/**
 * The 5 status-semantic tab accent colors. `var` references a CSS custom
 * property defined in `globals.css` (light + dark), so the rendered hue tracks
 * the theme. Single source for both the context-menu picker and the left-edge
 * bar in `TabBar`. Order is the picker order.
 */
export const TAB_COLORS: { id: TabColor; label: string; var: string }[] = [
  { id: "idle", label: "Idle", var: "var(--tab-idle)" },
  { id: "working", label: "Working", var: "var(--tab-working)" },
  { id: "question", label: "Question", var: "var(--tab-question)" },
  { id: "error", label: "Error", var: "var(--tab-error)" },
  { id: "done", label: "Done", var: "var(--tab-done)" },
];

/** CSS value for a tab's accent color, or undefined when uncolored. */
export function tabColorVar(color: TabColor | undefined): string | undefined {
  if (!color) return undefined;
  return `var(--tab-${color})`;
}
