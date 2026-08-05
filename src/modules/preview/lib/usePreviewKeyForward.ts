import { usePreferencesStore } from "@/modules/settings/preferences";
import { type KeyBinding, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import { useEffect } from "react";
import {
  listenPreviewKey,
  type PreviewKeyCombo,
  previewSetKeyCombos,
} from "./previewWebview";

/**
 * Whitelist of shortcut ids that stay app-owned while a Preview webview holds
 * focus — window/tab navigation the app needs reachable everywhere. Every
 * other combo (ctrl+c/v/a/d/i/x, ctrl+w, ctrl+p, ...) is deliberately left
 * unforwarded so it falls through to the previewed site's own handler
 * instead of being eaten by the host shortcut it happens to collide with.
 */
const PREVIEW_FORWARDED_IDS = new Set([
  "tab.next",
  "tab.prev",
  "tabs.panel.toggle",
  "sidebar.viewExplorer",
  "space.next", // ctrl+shift+]
  "space.prev", // ctrl+shift+[
]);

/**
 * Makes a small whitelist of host keyboard shortcuts work while a native
 * Preview tab holds focus, without stealing keys the previewed site owns.
 *
 * The preview is a separate-process child webview that owns its own keyboard
 * input, so the host `window` keydown listener (useGlobalShortcuts) never sees
 * keys typed there — Ctrl+Tab and friends would be dead until the user clicked
 * back into the host. This hook:
 *   1. flattens the whitelisted shortcut bindings into combos and pushes them
 *      to the backend, which seeds them into every preview webview
 *      (preview.rs) — only these are intercepted in-page;
 *   2. listens for the `terax:preview-key` events the in-page forwarder emits
 *      for matched combos, and replays each as a synthetic `keydown` on the host
 *      window so the normal shortcut handler runs.
 */
export function usePreviewKeyForward(): void {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  // Push the active combos whenever the user's bindings change.
  useEffect(() => {
    const combos: PreviewKeyCombo[] = [];
    const add = (b: KeyBinding, key = b.key) =>
      combos.push({
        key: key.toLowerCase(),
        ctrl: !!b.ctrl,
        shift: !!b.shift,
        alt: !!b.alt,
        meta: !!b.meta,
      });
    for (const s of SHORTCUTS) {
      if (!PREVIEW_FORWARDED_IDS.has(s.id)) continue;
      const bindings = userShortcuts[s.id] || s.defaultBindings;
      for (const b of bindings) {
        if (s.id === "tab.selectByIndex") {
          // Defined with key "1" but matches 1–9; expand so each digit forwards.
          for (let n = 1; n <= 9; n++) add(b, String(n));
        } else {
          add(b);
        }
      }
    }
    void previewSetKeyCombos(combos);
  }, [userShortcuts]);

  // Replay forwarded preview key events as synthetic host keydowns.
  useEffect(() => {
    const unlisten = listenPreviewKey((e) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrl,
          shiftKey: e.shift,
          altKey: e.alt,
          metaKey: e.meta,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}
