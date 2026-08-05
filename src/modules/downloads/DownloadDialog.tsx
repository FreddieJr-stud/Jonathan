import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  downloadDiscard,
  downloadSaveAs,
  downloadSaveToDir,
  formatBytes,
  isPreviewable,
  listenDownloadFinished,
} from "./lib/downloads";
import { useDownloadStore } from "./store/downloadStore";

type Props = {
  /** Open a staged file in a tab (PdfView / ImageView / editor by extension). */
  onPreview: (path: string) => void;
  /**
   * Root of the active space, offered as a one-click save target. Null when no
   * space is open, in which case the button is hidden rather than pointed at
   * some fallback directory the user never chose.
   */
  workspaceRoot: string | null;
};

/**
 * Prompt shown when a download started in a preview webview lands.
 *
 * The file is already on disk — staged, not saved (see
 * `src-tauri/src/modules/download.rs` for why the prompt can't come first).
 * Dismissing without choosing is a valid answer: the file stays staged and the
 * hourly sweep deletes it 24h after it arrived.
 *
 * Radix `Dialog` already pushes a `previewSuppress` reason, so the native
 * preview webview hides itself while this is open instead of painting over it.
 */
export function DownloadDialog({ onPreview, workspaceRoot }: Props) {
  const current = useDownloadStore((s) => s.queue[0]);
  const push = useDownloadStore((s) => s.push);
  const resolve = useDownloadStore((s) => s.resolve);

  useEffect(() => {
    const unlisten = listenDownloadFinished(push);
    return () => {
      void unlisten.then((f) => f());
    };
  }, [push]);

  if (!current) return null;

  const previewable = current.success && isPreviewable(current.name);
  const workspaceName = workspaceRoot
    ? (workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot)
    : null;

  const saveToWorkspace = async () => {
    if (!workspaceRoot) return;
    try {
      const written = await downloadSaveToDir(current.path, workspaceRoot);
      // Surface the real name: a clash silently became "file (1).pdf".
      toast.success(`Saved ${written.split(/[\\/]/).pop()}`);
    } catch (e) {
      console.error("save to workspace failed:", e);
      toast.error("Could not save to the workspace folder.");
      return;
    }
    resolve();
  };

  const saveAs = async () => {
    let dest: string | null;
    try {
      dest = await save({ defaultPath: current.name });
    } catch (e) {
      // A rejected picker (e.g. missing `dialog:allow-save` capability) would
      // otherwise escape as an unhandled rejection and read as a dead button.
      console.error("save dialog failed:", e);
      toast.error("Could not open the save dialog.");
      return;
    }
    // Cancelled picker: keep the prompt open so the choice isn't lost.
    if (!dest) return;
    try {
      await downloadSaveAs(current.path, dest);
    } catch (e) {
      console.error("save downloaded file failed:", e);
      toast.error("Could not save the file.");
      return;
    }
    resolve();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Esc / outside click / X — leave it staged to expire on its own.
        if (!open) resolve();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {current.success ? "Download finished" : "Download failed"}
          </DialogTitle>
          <DialogDescription className="break-all">
            {current.success ? (
              <>
                <span className="font-medium text-foreground">
                  {current.name}
                </span>
                {current.size > 0 ? ` · ${formatBytes(current.size)}` : null}
                <br />
                Kept temporarily — deleted automatically in 24 hours unless you
                save it.
              </>
            ) : (
              <>Nothing was saved. The download did not complete.</>
            )}
          </DialogDescription>
        </DialogHeader>
        {current.success ? (
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void downloadDiscard(current.path).catch((e) =>
                    console.error("discard download failed:", e),
                  );
                  resolve();
                }}
              >
                Delete now
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void revealItemInDir(current.path).catch((e) =>
                    console.error("revealItemInDir failed:", e),
                  );
                }}
              >
                Reveal
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {previewable ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onPreview(current.path);
                    resolve();
                  }}
                >
                  Preview
                </Button>
              ) : null}
              {workspaceName ? (
                <Button
                  type="button"
                  size="sm"
                  title={`Save to ${workspaceRoot}`}
                  onClick={() => void saveToWorkspace()}
                >
                  Save to {workspaceName}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={workspaceName ? "secondary" : "default"}
                size="sm"
                onClick={() => void saveAs()}
              >
                Save as…
              </Button>
            </div>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button type="button" size="sm" onClick={resolve}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
