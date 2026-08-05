import { useLayoutEffect, useRef, useState } from "react";
import type { ContentMenuState } from "../hooks/useContentContextMenu";

export type ContentContextMenuProps = {
  menu: ContentMenuState;
  onAsk: () => void;
  onClose: () => void;
};

const WIDTH = 184;

/**
 * Pointer-positioned right-click menu for the editor / terminal. Driven by
 * {@link useContentContextMenu}. Single action: "Ask Jonathan" spawns a fresh
 * chat session and auto-sends an "Expound on" prompt with the selected text.
 */
export function ContentContextMenu({
  menu,
  onAsk,
  onClose,
}: ContentContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: menu.y, left: menu.x });

  // Clamp into the viewport once the real height is known.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setPos({
      top: Math.min(menu.y, window.innerHeight - h - 8),
      left: Math.min(menu.x, window.innerWidth - WIDTH - 8),
    });
  }, [menu.x, menu.y]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      data-content-context-menu
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
      className="fixed z-50 flex flex-col gap-0.5 rounded-xl border border-border/60 bg-card/95 p-1 text-xs shadow-lg backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <MenuItem onClick={run(onAsk)}>Ask Jonathan about selection</MenuItem>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 items-center rounded-lg px-2.5 text-left text-foreground/90 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
