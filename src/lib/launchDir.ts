import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;

export async function initLaunchDir(): Promise<void> {
  // Both calls fired concurrently -- workspace_current_dir doesn't depend on
  // get_launch_dir's result, it's only used as a fallback when that one is
  // null (already drained, or no cli-passed dir), so there's no reason to
  // pay the two IPC round trips sequentially.
  const [primary, fallback] = await Promise.all([
    invoke<string | null>("get_launch_dir").catch(() => null),
    invoke<string>("workspace_current_dir").catch(() => null),
  ]);
  const dir = primary ?? fallback;
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}
