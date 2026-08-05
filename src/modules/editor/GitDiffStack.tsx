import type { GitCommitFileDiffTab, GitDiffTab, Tab } from "@/modules/tabs";
import { SurfaceItem, usePaneLayout } from "@/modules/terminal";
import { GitDiffPane } from "./GitDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function GitDiffStack({ tabs, activeId }: Props) {
  // Single-render kind: mount only the active tab plus any docked group panes.
  const paneIds = usePaneLayout((s) => (s.active ? s.paneIds : null));
  const items = tabs.filter(
    (t): t is GitDiffTab | GitCommitFileDiffTab =>
      (t.kind === "git-diff" || t.kind === "git-commit-file") &&
      (t.id === activeId || (paneIds?.has(t.id) ?? false)),
  );
  if (items.length === 0) return null;
  return (
    // No `relative` — see EditorStack.tsx for why this can't be SurfaceItem's
    // containing block.
    <div className="h-full w-full">
      {items.map((t) => (
        <SurfaceItem key={t.id} tabId={t.id} fallbackVisible={t.id === activeId}>
          {t.kind === "git-diff" ? (
            <GitDiffPane
              active
              source={{
                kind: "working",
                repoRoot: t.repoRoot,
                path: t.path,
                mode: t.mode,
                originalPath: t.originalPath,
              }}
            />
          ) : (
            <GitDiffPane
              active
              source={{
                kind: "commit",
                repoRoot: t.repoRoot,
                sha: t.sha,
                path: t.path,
                originalPath: t.originalPath,
              }}
              chipLabel={t.shortSha}
            />
          )}
        </SurfaceItem>
      ))}
    </div>
  );
}
