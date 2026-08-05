import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Frontend side of `src-tauri/src/modules/download.rs`. Downloads started in a
 * preview webview are redirected into a staging directory; this module carries
 * the "it landed" event to the prompt and the user's answer back to disk.
 */

export type DownloadFinished = {
  url: string;
  /** Absolute path inside the staging directory. Empty when `success` is false. */
  path: string;
  name: string;
  size: number;
  success: boolean;
};

/** Subscribe to finished downloads. Resolves to the unlisten function. */
export function listenDownloadFinished(
  handler: (d: DownloadFinished) => void,
): Promise<() => void> {
  return listen<DownloadFinished>("terax:download-finished", (e) =>
    handler(e.payload),
  );
}

/** Move a staged file to a permanent location, out of the sweep's reach. */
export function downloadSaveAs(path: string, dest: string): Promise<void> {
  return invoke("download_save_as", { path, dest });
}

/**
 * Move a staged file into `dir`, keeping its name. Never overwrites — a clash
 * gains a ` (n)` suffix. Resolves to the path actually written.
 */
export function downloadSaveToDir(path: string, dir: string): Promise<string> {
  return invoke("download_save_to_dir", { path, dir });
}

/** Delete a staged file now rather than waiting for it to expire. */
export function downloadDiscard(path: string): Promise<void> {
  return invoke("download_discard", { path });
}

/** Delete staged files older than the 24h TTL. Returns how many were removed. */
export function downloadSweep(): Promise<number> {
  return invoke("download_sweep");
}

/** Human-readable file size for the prompt. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

// Extensions the app renders itself (PdfView / ImageView / the editor). Anything
// else is offered "Reveal" instead of a preview that would open blank or binary.
const PREVIEWABLE = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "log",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "html",
  "rs",
  "py",
  "go",
  "sh",
  "sql",
]);

/** Whether `name` is a file type the app can open in a tab. */
export function isPreviewable(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return !!ext && PREVIEWABLE.has(ext);
}
