import type { DeviceMirrorTab, Tab } from "@/modules/tabs";
import { SurfaceItem } from "@/modules/terminal";
import { DeviceMirrorPane } from "./DeviceMirrorPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function DeviceMirrorStack({ tabs, activeId }: Props) {
  const mirrors = tabs.filter(
    (t): t is DeviceMirrorTab => t.kind === "device-mirror" && !t.cold,
  );
  if (mirrors.length === 0) return null;
  return (
    // No `relative` — see EditorStack.tsx for why this can't be SurfaceItem's
    // containing block.
    <div className="h-full w-full">
      {mirrors.map((t) => (
        <SurfaceItem
          key={t.id}
          tabId={t.id}
          fallbackVisible={t.id === activeId}
        >
          {(visible) => <DeviceMirrorPane visible={visible} />}
        </SurfaceItem>
      ))}
    </div>
  );
}
