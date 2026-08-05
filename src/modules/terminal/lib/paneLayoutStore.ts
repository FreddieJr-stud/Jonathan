import type { CSSProperties } from "react";
import { create } from "zustand";

export type PaneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Bridges the tab-level split compositor (`PaneLayout`, which measures slot
 * rects) and the kind-stacks (which position each member surface into its
 * measured rect via `useSurfacePlacement`). Content never unmounts or moves in
 * the DOM tree — only its absolute geometry follows the layout.
 */
type PaneLayoutState = {
  /** A split host is currently on-screen. */
  active: boolean;
  /** Every pane (leaf) id of the active host's group — includes the host id. */
  paneIds: Set<number>;
  /** Pane id with focus within the active group. */
  focusedId: number | null;
  /** Measured slot rects, in workspace-container pixels, keyed by pane id. */
  rects: Map<number, PaneRect>;
  setLayout: (paneIds: Set<number>, focusedId: number | null) => void;
  setRect: (id: number, rect: PaneRect) => void;
  clear: () => void;
};

export const usePaneLayout = create<PaneLayoutState>((set) => ({
  active: false,
  paneIds: new Set(),
  focusedId: null,
  rects: new Map(),
  setLayout: (paneIds, focusedId) =>
    set((s) => {
      const same =
        s.active &&
        s.focusedId === focusedId &&
        s.paneIds.size === paneIds.size &&
        [...paneIds].every((id) => s.paneIds.has(id));
      if (same) return s;
      // Drop stale rects for panes no longer in the layout.
      const rects = new Map<number, PaneRect>();
      for (const [id, r] of s.rects) if (paneIds.has(id)) rects.set(id, r);
      return { active: true, paneIds, focusedId, rects };
    }),
  setRect: (id, rect) =>
    set((s) => {
      const prev = s.rects.get(id);
      if (
        prev &&
        prev.left === rect.left &&
        prev.top === rect.top &&
        prev.width === rect.width &&
        prev.height === rect.height
      ) {
        return s;
      }
      const rects = new Map(s.rects);
      rects.set(id, rect);
      return { rects };
    }),
  clear: () =>
    set((s) =>
      !s.active && s.paneIds.size === 0
        ? s
        : { active: false, paneIds: new Set(), focusedId: null, rects: new Map() },
    ),
}));

export type SurfacePlacement = {
  /** Absolute geometry when this tab is a member of the active split; else undefined (caller falls back to `inset-0`). */
  style: CSSProperties | undefined;
  visible: boolean;
};

/**
 * Resolves where/whether a tab's surface should render. When a split layout is
 * active and `tabId` is one of its panes, returns the measured rect; otherwise
 * returns the legacy behavior (full surface, visible iff `activeFallback`).
 */
export function useSurfacePlacement(
  tabId: number,
  activeFallback: boolean,
): SurfacePlacement {
  const isPane = usePaneLayout((s) => s.active && s.paneIds.has(tabId));
  const rect = usePaneLayout((s) =>
    s.active && s.paneIds.has(tabId) ? s.rects.get(tabId) : undefined,
  );
  if (isPane) {
    if (!rect) return { style: undefined, visible: false };
    return {
      style: {
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      visible: true,
    };
  }
  return { style: undefined, visible: activeFallback };
}
