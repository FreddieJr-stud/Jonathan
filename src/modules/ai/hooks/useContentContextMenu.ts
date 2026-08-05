import { useCallback, useEffect, useState } from "react";

export type ContentMenuState = {
  x: number;
  y: number;
  /** Selection text captured from the surface at right-click time. */
  text: string;
};

/**
 * Shows terax's own right-click menu inside the code editor (`.cm-editor`) and
 * terminal (`.xterm`) when there is a text selection, offering a single "Ask
 * Jonathan" action. Right-clicks with no selection — and anywhere outside those
 * surfaces — fall through to the OS menu untouched.
 *
 * Selection is sampled at right-click time via `captureActiveSelection` (routes
 * to the active tab's surface).
 */
export function useContentContextMenu(
  captureSelectionFromElement: (el: HTMLElement) => string | null,
) {
  const [menu, setMenu] = useState<ContentMenuState | null>(null);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const inEditor = el.closest(".cm-editor");
      const inTerminal = el.closest(".xterm");
      if (!inEditor && !inTerminal) return; // leave native menu elsewhere
      const text = captureSelectionFromElement(el);
      if (!text?.trim()) return; // no selection -> native menu
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, text });
    };
    const onPointerDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-content-context-menu]")) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onBlur = () => setMenu(null);

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [captureSelectionFromElement]);

  const close = useCallback(() => setMenu(null), []);
  return { menu, close };
}
