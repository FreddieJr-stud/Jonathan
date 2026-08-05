import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { initLaunchDir } from "./lib/launchDir";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";
import {
  suppressPreview,
  unsuppressPreview,
} from "./modules/preview/lib/previewSuppress";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Render-instrumentation overlay, opt-in: `VITE_REACT_SCAN=true pnpm dev`.
// Dev-only dynamic import so it never reaches the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// Two independent boot tasks, run concurrently so first paint waits on the
// slower of the two rather than their sum:
//   - reap PTY sessions orphaned by a prior webview load before any tab spawns
//   - seed the launch dir so the default tab mounts at target cwd (no flicker)
// Both still settle before render, preserving the original ordering guarantees.
await Promise.all([
  invoke("pty_close_all").catch(() => {}),
  initLaunchDir(),
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);

// Window starts hidden (per tauri.conf.json) so users never see a transparent
// shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire.
const showWindow = () => {
  getCurrentWindow()
    .show()
    .then(() => {
      // A preview tab restored from last session creates its native WebView2
      // child (see PreviewPane) as soon as it mounts, which can race ahead of
      // this show() — under boot-time contention (e.g. launched from the
      // Startup folder alongside other autostart apps) the child's first frame
      // can composite while the host window is still hidden and gets stuck
      // blank forever after. Toggling suppress forces preview_hide then
      // preview_show again now that the host is actually visible, which makes
      // WebView2 recomposite. No-op if no preview webview exists yet.
      suppressPreview("boot-nudge");
      setTimeout(() => unsuppressPreview("boot-nudge"), 16);
    })
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
