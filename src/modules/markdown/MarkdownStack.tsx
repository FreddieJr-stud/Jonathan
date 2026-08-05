import type { MarkdownTab, Tab } from "@/modules/tabs";
import { SurfaceItem } from "@/modules/terminal";
import { MarkdownWysiwyg, type MarkdownWysiwygHandle } from "./MarkdownWysiwyg";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
  registerHandle?: (id: number, h: MarkdownWysiwygHandle | null) => void;
};

export function MarkdownStack({
  tabs,
  activeId,
  onSetMarkdownView,
  registerHandle,
}: Props) {
  const markdowns = tabs.filter(
    (t): t is MarkdownTab => t.kind === "markdown" && !t.cold,
  );
  if (markdowns.length === 0) return null;
  return (
    // No `relative` — see EditorStack.tsx for why this can't be SurfaceItem's
    // containing block.
    <div className="h-full w-full">
      {markdowns.map((t) => (
        <SurfaceItem
          key={t.id}
          tabId={t.id}
          fallbackVisible={t.id === activeId}
        >
          {(visible) => (
            <MarkdownWysiwyg
              ref={(h) => registerHandle?.(t.id, h)}
              path={t.path}
              visible={visible}
              onSetView={(mode) => onSetMarkdownView(t.id, mode)}
            />
          )}
        </SurfaceItem>
      ))}
    </div>
  );
}
