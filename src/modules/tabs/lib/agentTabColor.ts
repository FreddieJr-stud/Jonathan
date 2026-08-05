import type { AgentStatus } from "@/modules/agents/lib/types";
import type { TabColor } from "./useTabs";

/** Minimal shape of an agent session needed to color a tab. */
type SessionLike = { tabId: number; status: AgentStatus };

/** Maps an agent status onto the tab accent palette. */
const STATUS_COLOR: Record<AgentStatus, TabColor> = {
  idle: "idle",
  working: "working",
  waiting: "question",
  done: "done",
};

// Higher wins when a tab has multiple panes in different states. Attention
// (waiting) is most urgent; idle is least, so a busy/finished sibling shows
// over a dormant one.
const PRIORITY: Record<AgentStatus, number> = {
  waiting: 3,
  working: 2,
  done: 1,
  idle: 0,
};

/**
 * Live accent color derived from a tab's agent session(s), or undefined when no
 * session is active for the tab. When panes disagree, the highest-priority
 * status wins (waiting > working > done > idle).
 */
export function agentColorForTab(
  sessions: Record<number, SessionLike>,
  tabId: number,
): TabColor | undefined {
  let best: AgentStatus | undefined;
  for (const id in sessions) {
    const s = sessions[id];
    if (s.tabId !== tabId) continue;
    if (best === undefined || PRIORITY[s.status] > PRIORITY[best]) {
      best = s.status;
    }
  }
  return best === undefined ? undefined : STATUS_COLOR[best];
}
