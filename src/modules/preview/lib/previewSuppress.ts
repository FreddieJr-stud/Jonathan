import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useId, useRef } from "react";
import { create } from "zustand";

/**
 * Native preview webviews paint ABOVE all HTML, so they must be hidden whenever
 * something needs to draw over the workspace (command palette, modals) or the
 * window loses focus. Callers push/pop a named reason; the webview is suppressed
 * while any reason is active.
 */
type SuppressState = {
  reasons: Set<string>;
  suppressed: boolean;
  push: (reason: string) => void;
  pop: (reason: string) => void;
};

export const usePreviewSuppress = create<SuppressState>((set) => ({
  reasons: new Set(),
  suppressed: false,
  push: (reason) =>
    set((s) => {
      if (s.reasons.has(reason)) return s;
      const reasons = new Set(s.reasons);
      reasons.add(reason);
      return { reasons, suppressed: reasons.size > 0 };
    }),
  pop: (reason) =>
    set((s) => {
      if (!s.reasons.has(reason)) return s;
      const reasons = new Set(s.reasons);
      reasons.delete(reason);
      return { reasons, suppressed: reasons.size > 0 };
    }),
}));

/** Imperative helpers for non-React callers (effects, event handlers). */
export const suppressPreview = (reason: string) =>
  usePreviewSuppress.getState().push(reason);
export const unsuppressPreview = (reason: string) =>
  usePreviewSuppress.getState().pop(reason);

/**
 * Returns an `onOpenChange`-style callback that suppresses the preview webview
 * while a floating overlay (dropdown/context/popover/select/menubar) is open.
 *
 * Driven by the overlay's open STATE, not its Content mount: Radix keeps Content
 * mounted through its close animation and only unmounts on `animationend`, which
 * can fail to fire — leaving a mount-based suppressor stuck and the webview
 * hidden forever. `onOpenChange(false)` fires synchronously on close instead.
 * Pops on unmount too, in case the overlay is removed while still open.
 */
export function useOverlaySuppress() {
  const reason = `overlay:${useId()}`;
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  useEffect(() => () => unsuppressPreview(reasonRef.current), []);
  return useCallback(
    (open: boolean) => {
      if (open) suppressPreview(reason);
      else unsuppressPreview(reason);
    },
    [reason],
  );
}

/**
 * Suppresses the preview webview while `open` is true, driven by the overlay's
 * open STATE rather than its `onOpenChange` callback.
 *
 * Radix only fires `onOpenChange` when the primitive itself requests the change
 * (trigger click, Escape, outside click). A *controlled* overlay opened
 * programmatically — `open={newSpaceOpen}` flipped by a shortcut — changes the
 * prop without ever calling it, so an `onOpenChange`-based suppressor never
 * fires and the native webview paints over the dialog. Reading the resolved
 * open state covers both controlled and uncontrolled callers.
 */
export function useOverlaySuppressOpen(open: boolean) {
  const reason = `overlay:${useId()}`;
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  useEffect(() => {
    if (open) suppressPreview(reason);
    else unsuppressPreview(reason);
  }, [open, reason]);
  // Pop on unmount too, in case the overlay is removed while still open.
  useEffect(() => () => unsuppressPreview(reasonRef.current), []);
}

// Hide previews while the app window is not frontmost — a native webview would
// otherwise stay painted over whatever the OS brings in front.
//
// Tauri's `onFocusChanged` fires a transient blur→focus pair when our OWN
// preview child webview takes focus on navigation, which would flicker the page
// (suppress→white→unsuppress→page). So we DEBOUNCE blur: a real background
// switch keeps focus lost past the delay and suppresses; a self-focus blip gets
// its focus-back within ms, cancelling the pending suppress before it applies.
if (typeof window !== "undefined") {
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const clearBlur = () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = undefined;
    unsuppressPreview("window-blur");
  };
  getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (focused) {
        clearBlur();
      } else {
        if (blurTimer) clearTimeout(blurTimer);
        blurTimer = setTimeout(() => suppressPreview("window-blur"), 250);
      }
    })
    .catch(() => {});

  // Self-heal: recovery above hinges entirely on the focus-regained event
  // arriving, and it does not always — a window owning child webviews can have
  // focus restored to a child (or across a workspace switch) without the host
  // seeing `focused: true`. The reason then sticks, the webview stays hidden,
  // and the pane reads as a permanently white page that only an app restart
  // clears. Any interaction with the host document proves we ARE frontmost, so
  // treat it as the focus event we never got. Capture-phase and passive so this
  // never interferes with the app's own handlers.
  const opts = { capture: true, passive: true } as const;
  for (const ev of ["pointerdown", "keydown", "focus"] as const) {
    window.addEventListener(
      ev,
      () => {
        if (usePreviewSuppress.getState().reasons.has("window-blur"))
          clearBlur();
      },
      opts,
    );
  }
}
