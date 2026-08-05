import type { DashboardClientTab, Tab } from "@/modules/tabs";
import { SurfaceItem } from "@/modules/terminal";
import { DashboardClientPane } from "./DashboardClientPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function DashboardClientStack({ tabs, activeId }: Props) {
  const clients = tabs.filter(
    (t): t is DashboardClientTab => t.kind === "dashboard-client" && !t.cold,
  );
  if (clients.length === 0) return null;
  return (
    // No `relative` — see EditorStack.tsx for why this can't be SurfaceItem's
    // containing block.
    <div className="h-full w-full">
      {clients.map((t) => (
        <SurfaceItem
          key={t.id}
          tabId={t.id}
          fallbackVisible={t.id === activeId}
        >
          <DashboardClientPane />
        </SurfaceItem>
      ))}
    </div>
  );
}
