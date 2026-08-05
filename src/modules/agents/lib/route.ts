import { usePreferencesStore } from "@/modules/settings/preferences";
import { showAgentToast } from "../components/AgentToast";
import { useAgentStore } from "../store/agentStore";
import { osNotify } from "./notify";
import { truncatePath } from "./path";
import type { AgentSource, NotificationKind } from "./types";

type RouteArgs = {
  source: AgentSource;
  agent: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Working directory of the instance, when known. */
  dirPath?: string;
  /** First couple lines of output/response, for a descriptive subtext. */
  preview?: string;
  focused: boolean;
  tabId?: number;
  leafId?: number;
  onActivate: () => void;
};

function describedBody(body: string | undefined, dirPath?: string, preview?: string): string | undefined {
  const lines = [dirPath && truncatePath(dirPath), preview].filter((l): l is string => !!l);
  if (lines.length === 0) return body;
  return lines.join("\n");
}

export function routeAgentNotification({
  source,
  agent,
  kind,
  title,
  body,
  dirPath,
  preview,
  focused,
  tabId = 0,
  leafId = 0,
  onActivate,
}: RouteArgs): void {
  if (!usePreferencesStore.getState().agentNotifications) return;

  useAgentStore
    .getState()
    .pushNotification({ source, agent, kind, tabId, leafId, dirPath, preview });

  const fullBody = describedBody(body, dirPath, preview);

  if (!focused) {
    void osNotify(title, fullBody ?? agent, onActivate);
    return;
  }
  showAgentToast({ agent, title, body: fullBody, onActivate });
}
