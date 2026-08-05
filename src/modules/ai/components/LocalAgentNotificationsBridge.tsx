import { routeAgentNotification } from "@/modules/agents/lib/route";
import { useWindowFocus } from "@/modules/agents/lib/useWindowFocus";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { AgentStatus } from "@/modules/agents/lib/types";
import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";

const AGENT = "Jonathan";

type RunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "awaiting-approval"
  | "error";

function isBusy(s: RunStatus): boolean {
  return s === "thinking" || s === "streaming" || s === "awaiting-approval";
}

function liveStatus(s: RunStatus): AgentStatus | null {
  if (s === "awaiting-approval") return "waiting";
  if (s === "thinking" || s === "streaming") return "working";
  return null;
}

export function LocalAgentNotificationsBridge() {
  const status = useChatStore((s) => s.agentMeta.status) as RunStatus;
  const error = useChatStore((s) => s.agentMeta.error);
  const step = useChatStore((s) => s.agentMeta.step);
  const focused = useWindowFocus();

  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const prev = useRef<RunStatus>(status);
  // agentMeta.step is cleared once a run ends, so track the last non-null
  // value to use as the notification preview line.
  const lastStepRef = useRef<string | null>(null);
  if (step) lastStepRef.current = step;

  useEffect(() => {
    useAgentStore.getState().setLocalAgent(
      liveStatus(status) ? { agent: AGENT, status: liveStatus(status)! } : null,
    );

    const was = prev.current;
    prev.current = status;
    if (was === status) return;

    const dirPath =
      useChatStore.getState().live.getWorkspaceRoot() ??
      useChatStore.getState().live.getCwd() ??
      undefined;

    const fire = (
      kind: "attention" | "finished" | "error",
      title: string,
      body?: string,
    ) =>
      routeAgentNotification({
        source: "local",
        agent: AGENT,
        kind,
        title,
        body,
        dirPath,
        preview: lastStepRef.current ?? undefined,
        focused: focusedRef.current,
        onActivate: () => useChatStore.getState().openPanel(),
      });

    if (status === "awaiting-approval") {
      fire("attention", "Jonathan needs your approval", "Approve a tool to continue");
    } else if (status === "error") {
      fire("error", "Jonathan run failed", error ?? undefined);
    } else if (status === "idle" && isBusy(was)) {
      fire("finished", "Jonathan finished", "Your task is ready");
    }
  }, [status, error]);

  return null;
}
