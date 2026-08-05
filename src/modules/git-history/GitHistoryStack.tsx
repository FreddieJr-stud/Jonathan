import type { GitHistoryTab, Tab } from "@/modules/tabs";
import { SurfaceItem, usePaneLayout } from "@/modules/terminal";
import { GitHistoryPane, type GitHistorySearchHandle } from "./GitHistoryPane";

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
  onSearchHandle?: (handle: GitHistorySearchHandle | null) => void;
};

export function GitHistoryStack({
  tabs,
  activeId,
  onOpenCommitFile,
  onSearchHandle,
}: Props) {
  // Single-render kind: mount only the active tab plus any docked group panes.
  const paneIds = usePaneLayout((s) => (s.active ? s.paneIds : null));
  const items = tabs.filter(
    (t): t is GitHistoryTab =>
      t.kind === "git-history" &&
      (t.id === activeId || (paneIds?.has(t.id) ?? false)),
  );
  if (items.length === 0) return null;
  return (
    // No `relative` — see EditorStack.tsx for why this can't be SurfaceItem's
    // containing block.
    <div className="h-full w-full">
      {items.map((t) => (
        <SurfaceItem key={t.id} tabId={t.id} fallbackVisible={t.id === activeId}>
          <GitHistoryPane
            repoRoot={t.repoRoot}
            onOpenCommitFile={onOpenCommitFile}
            onSearchHandle={t.id === activeId ? onSearchHandle : undefined}
          />
        </SurfaceItem>
      ))}
    </div>
  );
}
