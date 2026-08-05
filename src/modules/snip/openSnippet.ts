import { invoke } from "@tauri-apps/api/core";
import type { SnipRect } from "./SnipOverlay";

/**
 * Spawns a floating always-on-top window holding `dataUrl`, positioned over
 * `sel` so the crop appears to lift straight off the content it came from.
 */
export async function openSnippetWindow(dataUrl: string, sel: SnipRect) {
  await invoke("open_snippet_window", {
    label: `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dataUrl,
    width: sel.width,
    height: sel.height,
    x: window.screenX + sel.left,
    y: window.screenY + sel.top,
  });
}
