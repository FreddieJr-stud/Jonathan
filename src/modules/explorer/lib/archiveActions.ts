import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { currentWorkspaceEnv } from "@/modules/workspace";

export type ArchiveFormat = "zip" | "7z";

export async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<boolean> {
  try {
    await invoke("archive_extract", {
      archivePath,
      destDir,
      workspace: currentWorkspaceEnv(),
    });
    return true;
  } catch (e) {
    toast.error(`Extract failed: ${String(e)}`);
    return false;
  }
}

export async function addToArchive(
  sources: string[],
  destArchive: string,
  format: ArchiveFormat,
): Promise<boolean> {
  try {
    await invoke("archive_add", {
      sources,
      destArchive,
      format,
      workspace: currentWorkspaceEnv(),
    });
    return true;
  } catch (e) {
    toast.error(`Compress failed: ${String(e)}`);
    return false;
  }
}
