import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSurfacePlacement } from "./lib/paneLayoutStore";

/**
 * Per-tab surface wrapper shared by every kind-stack. Replaces the old
 * `absolute inset-0` + visibility wrapper: when the tab is a pane of the active
 * split it positions to the measured rect; otherwise it fills the surface and
 * shows only when active. Content stays mounted regardless.
 */
export function SurfaceItem({
  tabId,
  fallbackVisible,
  className,
  children,
}: {
  tabId: number;
  fallbackVisible: boolean;
  className?: string;
  /** Plain node, or a render-prop receiving the resolved visibility. */
  children: ReactNode | ((visible: boolean) => ReactNode);
}) {
  const { style, visible } = useSurfacePlacement(tabId, fallbackVisible);
  return (
    <div
      style={style}
      className={cn(
        "absolute",
        !style && "inset-0",
        // A visible member must re-assert pointer events: in split mode the
        // kind-overlay wrapper is `pointer-events-none` so empty regions fall
        // through to the content behind.
        visible ? "pointer-events-auto" : "invisible pointer-events-none",
        className,
      )}
      aria-hidden={!visible}
    >
      {typeof children === "function" ? children(visible) : children}
    </div>
  );
}
