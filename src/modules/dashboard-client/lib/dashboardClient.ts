/**
 * Client for DashboardPlusPlus's sync API (see terax-sync-server plan in the
 * DashboardPlusPlus repo). REST for writes, one WebSocket for live reads —
 * the server always pushes a full `{boards, tasks}` snapshot rather than
 * diffs, so the client just replaces its local state wholesale on each
 * message.
 */

export type BoardDto = {
  id: number;
  name: string;
  position: number;
  colorArgb: number | null;
  createdAt: number;
};

export type SubtaskDto = {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  position: number;
};

export type TaskDto = {
  id: number;
  boardId: number;
  title: string;
  notes: string;
  colorArgb: number | null;
  position: number;
  startTime: number | null;
  endTime: number | null;
  durationMin: number | null;
  done: boolean;
  recurrenceRule: string | null;
  createdAt: number;
  completedAt: number | null;
  subtasks: SubtaskDto[];
};

export type Snapshot = {
  boards: BoardDto[];
  tasks: TaskDto[];
};

export type DashboardEndpoint = {
  /** host:port, e.g. "100.106.211.84:8787" */
  endpoint: string;
  token: string;
};

const ENDPOINT_KEY = "terax.dashboard.endpoint";
const TOKEN_KEY = "terax.dashboard.token";

export function loadEndpoint(): DashboardEndpoint | null {
  const endpoint = localStorage.getItem(ENDPOINT_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  if (!endpoint || !token) return null;
  return { endpoint, token };
}

export function saveEndpoint(cfg: DashboardEndpoint): void {
  localStorage.setItem(ENDPOINT_KEY, cfg.endpoint);
  localStorage.setItem(TOKEN_KEY, cfg.token);
}

export function clearEndpoint(): void {
  localStorage.removeItem(ENDPOINT_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export class DashboardApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  cfg: DashboardEndpoint,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`http://${cfg.endpoint}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new DashboardApiError(res.status, `${method} ${path} -> ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createDashboardApi(cfg: DashboardEndpoint) {
  return {
    listBoards: () => request<BoardDto[]>(cfg, "GET", "/boards"),
    createBoard: (name: string, colorArgb?: number | null) =>
      request<BoardDto>(cfg, "POST", "/boards", { name, colorArgb: colorArgb ?? null }),
    updateBoard: (id: number, patch: { name: string; position: number; colorArgb: number | null }) =>
      request<BoardDto>(cfg, "PUT", `/boards/${id}`, patch),
    deleteBoard: (id: number) => request<void>(cfg, "DELETE", `/boards/${id}`),

    listTasks: (boardId?: number) =>
      request<TaskDto[]>(cfg, "GET", boardId !== undefined ? `/tasks?boardId=${boardId}` : "/tasks"),
    createTask: (req: {
      boardId: number;
      title: string;
      notes?: string;
      colorArgb?: number | null;
      recurrenceRule?: string | null;
    }) =>
      request<TaskDto>(cfg, "POST", "/tasks", {
        notes: "",
        colorArgb: null,
        recurrenceRule: null,
        ...req,
      }),
    updateTask: (
      id: number,
      patch: {
        title: string;
        notes: string;
        colorArgb: number | null;
        position: number;
        startTime: number | null;
        endTime: number | null;
        durationMin: number | null;
        recurrenceRule: string | null;
      },
    ) => request<TaskDto>(cfg, "PUT", `/tasks/${id}`, patch),
    deleteTask: (id: number) => request<void>(cfg, "DELETE", `/tasks/${id}`),
    scheduleTask: (id: number, start: number | null, end: number | null) =>
      request<TaskDto>(cfg, "POST", `/tasks/${id}/schedule`, { start, end }),
    setTaskDone: (id: number, done: boolean) =>
      request<TaskDto>(cfg, "POST", `/tasks/${id}/done`, { done }),
    moveTask: (id: number, boardId: number, position: number) =>
      request<TaskDto>(cfg, "POST", `/tasks/${id}/move`, { boardId, position }),

    createSubtask: (taskId: number, title: string) =>
      request<SubtaskDto>(cfg, "POST", "/subtasks", { taskId, title }),
    updateSubtask: (id: number, patch: { title: string; position: number }) =>
      request<SubtaskDto>(cfg, "PUT", `/subtasks/${id}`, patch),
    deleteSubtask: (id: number) => request<void>(cfg, "DELETE", `/subtasks/${id}`),
    setSubtaskDone: (id: number, done: boolean) =>
      request<void>(cfg, "POST", `/subtasks/${id}/done`, { done }),
  };
}

export type DashboardApi = ReturnType<typeof createDashboardApi>;

export type SyncStatus = "connecting" | "open" | "closed";

/**
 * Opens the /sync WebSocket and calls `onSnapshot` for every full snapshot
 * the server pushes (initial state + one per write anywhere). Returns an
 * unsubscribe function; the caller owns reconnect policy.
 */
export function subscribeSnapshot(
  cfg: DashboardEndpoint,
  onSnapshot: (snapshot: Snapshot) => void,
  onStatus: (status: SyncStatus) => void,
): () => void {
  const ws = new WebSocket(`ws://${cfg.endpoint}/sync?token=${encodeURIComponent(cfg.token)}`);
  onStatus("connecting");
  ws.onopen = () => onStatus("open");
  ws.onclose = () => onStatus("closed");
  ws.onerror = () => onStatus("closed");
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string) as Snapshot;
      onSnapshot(data);
    } catch {
      // malformed frame — ignore, next snapshot will resync state
    }
  };
  return () => {
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
  };
}
