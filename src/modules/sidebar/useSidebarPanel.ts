import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { SidebarViewId } from "./types";

// A Windows minimize reports a tiny viewport (~160x28) without setting
// document.hidden. Any layout reaction to a viewport this small is the minimize
// artifact, not a real resize — ignore it.
const isMinimizedViewport = () =>
  window.innerWidth < 300 || window.innerHeight < 200;

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = "terax.sidebar.width";
const SIDEBAR_VIEW_STORAGE_KEY = "terax.sidebar.view";

function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function readSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function readSidebarView(): SidebarViewId {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY);
    if (
      stored === "explorer" ||
      stored === "source-control" ||
      stored === "tabs"
    )
      return stored;
  } catch {
    // ignore
  }
  return "explorer";
}

type FocusableExplorer = {
  focus: () => void;
  isFocused: () => boolean;
};

export function useSidebarPanel(
  explorerRef: RefObject<FocusableExplorer | null>,
) {
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarWidthRef = useRef(readSidebarWidth());
  const sidebarWidthWriteTimerRef = useRef(0);
  // Tracks whether the sidebar is collapsed because the *user* collapsed it, as
  // opposed to the panel library auto-collapsing it when the window is minimized
  // (minimize reports a near-zero container, which the constraint solver can't
  // fit the sidebar into). Only the latter should be undone on restore.
  const sidebarUserCollapsedRef = useRef(false);
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null);
  const [sidebarView, setSidebarViewState] =
    useState<SidebarViewId>(readSidebarView);

  const persistSidebarView = useCallback((view: SidebarViewId) => {
    setSidebarViewState(view);
    try {
      window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, view);
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    const p = sidebarRef.current;
    if (!p) return;
    if (p.getSize().asPercentage <= 0) {
      sidebarUserCollapsedRef.current = false;
      p.expand();
    } else {
      sidebarUserCollapsedRef.current = true;
      p.collapse();
    }
  }, []);

  const cycleSidebarView = useCallback(
    (view: SidebarViewId) => {
      const panel = sidebarRef.current;
      const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
      if (collapsed) {
        sidebarUserCollapsedRef.current = false;
        if (panel) panel.resize(`${sidebarWidthRef.current}px`);
        if (view !== sidebarView) persistSidebarView(view);
        return;
      }
      if (view === sidebarView) {
        sidebarUserCollapsedRef.current = true;
        panel?.collapse();
        return;
      }
      persistSidebarView(view);
    },
    [persistSidebarView, sidebarView],
  );

  const persistSidebarWidth = useCallback((next: number) => {
    sidebarWidthRef.current = next;
    if (sidebarWidthWriteTimerRef.current) {
      window.clearTimeout(sidebarWidthWriteTimerRef.current);
    }
    sidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      sidebarWidthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (sidebarWidthWriteTimerRef.current) {
        window.clearTimeout(sidebarWidthWriteTimerRef.current);
      }
    };
  }, []);

  // Panel onResize handler. While the window is minimized the library fires a
  // resize to ~0 as it auto-collapses against the tiny minimized viewport;
  // ignore those so we neither persist a bogus width nor flip the "user
  // collapsed" flag. A real (visible) collapse to 0 — e.g. dragging the handle
  // shut — is still recorded as user intent so we don't fight it on restore.
  const handleSidebarResize = useCallback(
    (size: { inPixels: number }) => {
      if (isMinimizedViewport()) return;
      if (size.inPixels > 0) {
        sidebarUserCollapsedRef.current = false;
        persistSidebarWidth(size.inPixels);
      } else {
        sidebarUserCollapsedRef.current = true;
      }
    },
    [persistSidebarWidth],
  );

  // On restore from minimize the panel was auto-collapsed against the tiny
  // minimized viewport. document.hidden never flips on a Windows Tauri minimize,
  // so detect the transition via Tauri's onResized + isMinimized instead.
  //
  // Subtlety: on restore the panel emits a 0px resize *while the viewport is
  // already full*, which handleSidebarResize reads as a deliberate collapse and
  // poisons sidebarUserCollapsedRef before this fires. So snapshot the real
  // intent when we *enter* minimize, then reapply it on restore.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let wasMinimized = false;
    let intentCollapsed = false;
    const win = getCurrentWindow();
    void win
      .onResized(async () => {
        const minimized = await win.isMinimized().catch(() => false);
        if (minimized && !wasMinimized) {
          // Entering minimize — capture intent before the restore-resize poisons it.
          intentCollapsed = sidebarUserCollapsedRef.current;
        }
        const restored = wasMinimized && !minimized;
        wasMinimized = minimized;
        if (!restored) return;
        const panel = sidebarRef.current;
        if (!panel) return;
        // Reapply the pre-minimize intent (undoes the poisoned flag).
        sidebarUserCollapsedRef.current = intentCollapsed;
        if (!intentCollapsed && panel.getSize().asPercentage <= 0) {
          panel.resize(`${sidebarWidthRef.current}px`);
        }
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggleExplorerFocus = useCallback(() => {
    const explorer = explorerRef.current;
    const panel = sidebarRef.current;
    const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
    if (sidebarView !== "explorer" || collapsed) {
      if (panel && collapsed) {
        sidebarUserCollapsedRef.current = false;
        panel.resize(`${sidebarWidthRef.current}px`);
      }
      if (sidebarView !== "explorer") persistSidebarView("explorer");
      const active = document.activeElement;
      explorerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      requestAnimationFrame(() => explorerRef.current?.focus());
      return;
    }
    if (!explorer) return;
    if (explorer.isFocused()) {
      const target = explorerReturnFocusRef.current;
      explorerReturnFocusRef.current = null;
      if (target && document.body.contains(target)) {
        target.focus();
      } else {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    const active = document.activeElement;
    explorerReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    explorer.focus();
  }, [explorerRef, persistSidebarView, sidebarView]);

  return {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    persistSidebarView,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    handleSidebarResize,
    toggleExplorerFocus,
  };
}
