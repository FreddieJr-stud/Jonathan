import { useEffect } from "react";

// Copy-on-select: mirror any committed DOM text selection into the clipboard,
// matching the Linux "primary selection" / terminal copyOnSelect behavior the
// user asked for. The xterm terminal manages its own selection on a canvas and
// is handled separately in the renderer pool (onSelectionChange); here we cover
// the HTML surfaces — code editor, rendered markdown, git diff/history views.
//
// Triggered on `mouseup` (the highlight-and-release gesture) and on shift-keyed
// `keyup` (keyboard selection), never on plain typing, so we don't clobber the
// clipboard while the user edits text.
export function useCopyOnSelect(): void {
  useEffect(() => {
    const copySelection = (target: EventTarget | null) => {
      // xterm owns its selection + clipboard; its DOM selection is empty anyway.
      if ((target as HTMLElement | null)?.closest?.(".xterm")) return;
      const sel = window.getSelection?.()?.toString() ?? "";
      if (sel.trim().length === 0) return;
      navigator.clipboard?.writeText(sel).catch(() => {});
    };

    const onMouseUp = (e: MouseEvent) => copySelection(e.target);
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.shiftKey && e.key !== "Shift") return;
      copySelection(e.target);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
