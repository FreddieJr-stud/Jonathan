export type AgentStatus = "idle" | "working" | "waiting" | "done";

export type AgentSource = "terminal" | "local";

export type AgentSignalKind =
  | "started"
  | "idle"
  | "working"
  | "attention"
  | "finished"
  | "exited";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
  /** Real notification/response text from the Claude Code hook payload, when available. */
  message: string | null;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
};

export type AgentNotification = {
  id: string;
  source: AgentSource;
  leafId: number;
  tabId: number;
  agent: string;
  kind: NotificationKind;
  at: number;
  read: boolean;
  /** Working directory of the instance, when known. */
  dirPath?: string;
  /** First couple lines of output/response, for a descriptive subtext. */
  preview?: string;
};

export type NotificationKind = "attention" | "finished" | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
