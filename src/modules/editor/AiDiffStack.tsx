import type { AiDiffTab, Tab } from "@/modules/tabs";
import { SurfaceItem, usePaneLayout } from "@/modules/terminal";
import { AiDiffPane } from "./AiDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onAccept: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
};

export function AiDiffStack({ tabs, activeId, onAccept, onReject }: Props) {
  // Single-render kind: mount only the active tab plus any docked group panes.
  const paneIds = usePaneLayout((s) => (s.active ? s.paneIds : null));
  const items = tabs.filter(
    (t): t is AiDiffTab =>
      t.kind === "ai-diff" &&
      (t.id === activeId || (paneIds?.has(t.id) ?? false)),
  );
  if (items.length === 0) return null;
  return (
    // No `relative` — see EditorStack.tsx for why this can't be SurfaceItem's
    // containing block.
    <div className="h-full w-full">
      {items.map((t) => (
        <SurfaceItem key={t.id} tabId={t.id} fallbackVisible={t.id === activeId}>
          <AiDiffPane
            path={t.path}
            originalContent={t.originalContent}
            proposedContent={t.proposedContent}
            status={t.status}
            isNewFile={t.isNewFile}
            onAccept={() => onAccept(t.approvalId)}
            onReject={() => onReject(t.approvalId)}
          />
        </SurfaceItem>
      ))}
    </div>
  );
}
