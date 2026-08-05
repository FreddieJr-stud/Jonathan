import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { Folder01Icon, FolderOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialName?: string;
  initialRoot?: string;
  onSubmit: (result: { name: string; root: string }) => void;
};

export function SpaceDialog({
  open,
  onOpenChange,
  mode,
  initialName,
  initialRoot,
  onSubmit,
}: Props) {
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const rootRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only on the open transition, not on every initialName/initialRoot change
  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    setRoot(initialRoot ?? "");
    setError(null);
    setChecking(false);
    setTimeout(() => rootRef.current?.focus(), 0);
  }, [open]);

  const browse = async () => {
    const picked = await openFolderDialog({
      directory: true,
      multiple: false,
      defaultPath: root || undefined,
    });
    if (typeof picked === "string") {
      setRoot(picked);
      setError(null);
    }
  };

  const submit = async () => {
    const trimmedRoot = root.trim();
    if (!trimmedRoot) {
      setError("Base root is required");
      return;
    }
    setChecking(true);
    try {
      const stat = await invoke<{ kind: string }>("fs_stat", {
        path: trimmedRoot,
        workspace: currentWorkspaceEnv(),
      });
      if (stat.kind !== "dir") {
        setError("Not a directory");
        return;
      }
    } catch {
      setError("Directory not found");
      return;
    } finally {
      setChecking(false);
    }
    onSubmit({ name: name.trim(), root: trimmedRoot });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex gap-1.75">
            <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.75} />
            {mode === "create" ? "New space" : "Edit space"}
          </DialogTitle>
          <DialogDescription>
            Name is optional — leave blank to use the root folder's name.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="space-dialog-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Space name (optional)
            </label>
            <Input
              id="space-dialog-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Auto from folder name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="space-dialog-root"
              className="text-xs font-medium text-muted-foreground"
            >
              Base root
            </label>
            <div className="flex gap-1.5">
              <Input
                id="space-dialog-root"
                ref={rootRef}
                value={root}
                onChange={(e) => {
                  setRoot(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="C:\path\to\project"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Browse for folder"
                onClick={() => void browse()}
              >
                <HugeiconsIcon
                  icon={FolderOpenIcon}
                  size={16}
                  strokeWidth={1.75}
                />
              </Button>
            </div>
          </div>
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={checking} onClick={() => void submit()}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
