import { type ComponentProps, type PointerEvent, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { DashboardClientStack } from "@/modules/dashboard-client";
import { DeviceMirrorStack } from "@/modules/device-mirror";
import { AiDiffStack, EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { MarkdownStack } from "@/modules/markdown";
import { PreviewStack } from "@/modules/preview";
import type { Tab } from "@/modules/tabs";
import { PaneLayout, TerminalStack, usePaneLayout } from "@/modules/terminal";

type TerminalStackProps = ComponentProps<typeof TerminalStack>;
type EditorStackProps = ComponentProps<typeof EditorStack>;
type MarkdownStackProps = ComponentProps<typeof MarkdownStack>;
type PreviewStackProps = ComponentProps<typeof PreviewStack>;
type AiDiffStackProps = ComponentProps<typeof AiDiffStack>;
type GitHistoryStackProps = ComponentProps<typeof GitHistoryStack>;

type Props = {
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  registerTerminalHandle: TerminalStackProps["registerHandle"];
  onSearchReady: TerminalStackProps["onSearchReady"];
  onCwd: TerminalStackProps["onCwd"];
  onExit: TerminalStackProps["onExit"];
  onFocusLeaf: TerminalStackProps["onFocusLeaf"];
  registerEditorHandle: EditorStackProps["registerHandle"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onAiDiffAccept: AiDiffStackProps["onAccept"];
  onAiDiffReject: AiDiffStackProps["onReject"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  onSetMarkdownView: EditorStackProps["onSetMarkdownView"];
  registerMarkdownHandle: MarkdownStackProps["registerHandle"];
  /** Focus a pane of the active split (clicked into its rect). */
  onFocusPane?: (tabId: number) => void;
  /** Undock a pane of the active split (its close button). */
  onClosePane?: (tabId: number) => void;
};

/**
 * Stacks every tab-kind surface absolutely on top of each other and toggles
 * visibility off the active tab, so panes keep their mounted state (terminal
 * buffers, editor scroll, ...) when switching tabs.
 *
 * When the active tab hosts a split (`group`), the per-kind visibility gate is
 * lifted: the overlays go pointer-transparent, each member surface positions
 * itself into a measured slot (see `SurfaceItem` / `usePaneLayout`), and
 * `PaneLayout` draws the resizable slot grid on top.
 */
export function WorkspaceSurface({
  tabs,
  activeId,
  activeTab,
  registerTerminalHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  registerEditorHandle,
  onEditorDirtyChange,
  onEditorCloseTab,
  registerPreviewHandle,
  onPreviewUrlChange,
  onAiDiffAccept,
  onAiDiffReject,
  onOpenCommitFile,
  onGitHistorySearchHandle,
  onSetMarkdownView,
  registerMarkdownHandle,
  onFocusPane,
  onClosePane,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const kind = activeTab?.kind;
  const group = activeTab?.group;
  const layoutActive = group != null;
  const focusedId = activeTab ? (activeTab.groupFocus ?? activeTab.id) : 0;

  const isTerminalTab = kind === "terminal";
  const isEditorTab = kind === "editor";
  const isPreviewTab = kind === "preview";
  const isMarkdownTab = kind === "markdown";
  const isAiDiffTab = kind === "ai-diff";
  const isGitDiffTab = kind === "git-diff" || kind === "git-commit-file";
  const isGitHistoryTab = kind === "git-history";
  const isDeviceMirrorTab = kind === "device-mirror";
  const isDashboardClientTab = kind === "dashboard-client";

  // While a split is shown, the overlay wrappers go pointer-transparent and stay
  // visible; per-tab `SurfaceItem`s gate their own visibility/hit-testing.
  const overlayCls = (isKind: boolean) =>
    cn(
      "absolute inset-0 px-3 pt-2 pb-2",
      layoutActive
        ? "pointer-events-none"
        : !isKind && "invisible pointer-events-none",
    );
  const overlayHidden = (isKind: boolean) => (layoutActive ? false : !isKind);

  // Clicking into a pane's rect moves group focus there (the event still flows
  // to the live content behind for actual interaction).
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!layoutActive || !onFocusPane) return;
      const container = containerRef.current;
      if (!container) return;
      const c = container.getBoundingClientRect();
      const x = e.clientX - c.left;
      const y = e.clientY - c.top;
      const { rects, paneIds } = usePaneLayout.getState();
      for (const id of paneIds) {
        const r = rects.get(id);
        if (
          r &&
          x >= r.left &&
          x <= r.left + r.width &&
          y >= r.top &&
          y <= r.top + r.height
        ) {
          onFocusPane(id);
          break;
        }
      }
    },
    [layoutActive, onFocusPane],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0"
      onPointerDownCapture={handlePointerDown}
    >
      <div className={overlayCls(isTerminalTab)} aria-hidden={overlayHidden(isTerminalTab)}>
        <TerminalStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerTerminalHandle}
          onSearchReady={onSearchReady}
          onCwd={onCwd}
          onExit={onExit}
          onFocusLeaf={onFocusLeaf}
        />
      </div>
      <div className={overlayCls(isEditorTab)} aria-hidden={overlayHidden(isEditorTab)}>
        <EditorStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerEditorHandle}
          onDirtyChange={onEditorDirtyChange}
          onCloseTab={onEditorCloseTab}
          onSetMarkdownView={onSetMarkdownView}
        />
      </div>
      <div className={overlayCls(isPreviewTab)} aria-hidden={overlayHidden(isPreviewTab)}>
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={onPreviewUrlChange}
        />
      </div>
      <div className={overlayCls(isMarkdownTab)} aria-hidden={overlayHidden(isMarkdownTab)}>
        <MarkdownStack
          tabs={tabs}
          activeId={activeId}
          onSetMarkdownView={onSetMarkdownView}
          registerHandle={registerMarkdownHandle}
        />
      </div>
      <div className={overlayCls(isAiDiffTab)} aria-hidden={overlayHidden(isAiDiffTab)}>
        <AiDiffStack
          tabs={tabs}
          activeId={activeId}
          onAccept={onAiDiffAccept}
          onReject={onAiDiffReject}
        />
      </div>
      <div className={overlayCls(isGitDiffTab)} aria-hidden={overlayHidden(isGitDiffTab)}>
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={overlayCls(isDeviceMirrorTab)}
        aria-hidden={overlayHidden(isDeviceMirrorTab)}
      >
        <DeviceMirrorStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={overlayCls(isDashboardClientTab)}
        aria-hidden={overlayHidden(isDashboardClientTab)}
      >
        <DashboardClientStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          layoutActive
            ? "pointer-events-none"
            : !isGitHistoryTab && "invisible pointer-events-none",
        )}
        aria-hidden={overlayHidden(isGitHistoryTab)}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={onOpenCommitFile}
          onSearchHandle={onGitHistorySearchHandle}
        />
      </div>
      {layoutActive && group && (
        <div className="pointer-events-none absolute inset-0 px-3 pt-2 pb-2">
          <PaneLayout
            group={group}
            focusedId={focusedId}
            containerRef={containerRef}
            onClosePane={(id) => onClosePane?.(id)}
          />
        </div>
      )}
    </div>
  );
}
