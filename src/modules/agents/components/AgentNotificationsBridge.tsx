import type { Tab } from "@/modules/tabs";
import { findLeafCwd, getLeafPreviewLines, hasLeaf, leafIdForPty } from "@/modules/terminal";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  focused: boolean;
  onActivate: Activate;
};

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string; dirPath?: string } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      return { tabId: t.id, title: t.title, dirPath: findLeafCwd(t.paneTree, leafId) };
    }
  }
  return null;
}

function route(
  session: AgentSession,
  kind: "attention" | "finished",
  message: string | null | undefined,
  ctx: Ctx,
): void {
  const info = tabInfo(ctx.tabs, session.leafId);
  const heading =
    kind === "attention"
      ? `${session.agent} needs your input`
      : `${session.agent} finished`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: info?.title,
    dirPath: info?.dirPath,
    preview: message ?? getLeafPreviewLines(session.leafId) ?? undefined,
    focused: ctx.focused,
    tabId: session.tabId,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      return;
    }
    case "idle":
      store.setStatus(leafId, "idle");
      return;
    case "working":
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      // The Notification hook fires for every type, including `idle_prompt`
      // (~60s after the agent goes idle). Those arrive when the agent is done or
      // freshly launched, not mid-task — surfacing them would reset a completed
      // (green) tab to "needs input". Only treat attention as real when the
      // agent is actively working, which is the only time a permission/
      // elicitation prompt can occur.
      const session = store.sessions[leafId];
      if (session?.status === "working") {
        store.setStatus(leafId, "waiting");
        route(session, "attention", sig.message, ctx);
      }
      return;
    }
    case "finished": {
      // Stop hook: a turn ended. Status is "done" (not attention); the bell
      // still gets a finished notification.
      store.setStatus(leafId, "done");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", sig.message, ctx);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "exited":
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
  }
}

export function AgentNotificationsBridge({
  tabs,
  onActivate,
}: {
  tabs: Tab[];
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({ tabs, focused, onActivate });
  ctxRef.current = { tabs, focused, onActivate };

  // Install the Jonathan Claude Code hooks on startup so a manually-launched
  // `claude` reports its state (idle/working/attention/finished) without the
  // user enabling them by hand. Idempotent and a no-op outside Jonathan.
  useEffect(() => {
    void invoke("agent_enable_claude_hooks").catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AgentSignal>("terax:agent-signal", (e) =>
      handleSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return null;
}
