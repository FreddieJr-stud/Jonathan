import { useCallback, useState } from "react";
import { Calendar03Icon, KanbanIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardView } from "./BoardView";
import { clearEndpoint, saveEndpoint, type DashboardEndpoint } from "./lib/dashboardClient";
import { ensureTailscaleUp } from "./lib/useDashboardSyncLifecycle";
import { ScheduleView } from "./ScheduleView";
import { useDashboardSyncStore } from "./store/dashboardSyncStore";

export function DashboardClientPane() {
  const cfg = useDashboardSyncStore((s) => s.cfg);
  const setCfg = useDashboardSyncStore((s) => s.setCfg);
  const status = useDashboardSyncStore((s) => s.status);
  const snapshot = useDashboardSyncStore((s) => s.snapshot);
  const api = useDashboardSyncStore((s) => s.api);
  const startingTailscale = useDashboardSyncStore((s) => s.startingTailscale);
  const tailscaleError = useDashboardSyncStore((s) => s.tailscaleError);
  const [view, setView] = useState<"board" | "schedule">("board");

  const handleForget = useCallback(() => {
    clearEndpoint();
    setCfg(null);
  }, [setCfg]);

  if (!cfg) {
    return <ConnectionSetup onConnected={setCfg} />;
  }

  if (!api) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connecting…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-xs">
        <div className="flex overflow-hidden rounded-md border border-border">
          <button
            onClick={() => setView("board")}
            className={`flex items-center gap-1 px-2 py-1 ${view === "board" ? "bg-accent" : "text-muted-foreground"}`}
          >
            <HugeiconsIcon icon={KanbanIcon} size={12} />
            Board
          </button>
          <button
            onClick={() => setView("schedule")}
            className={`flex items-center gap-1 px-2 py-1 ${view === "schedule" ? "bg-accent" : "text-muted-foreground"}`}
          >
            <HugeiconsIcon icon={Calendar03Icon} size={12} />
            Schedule
          </button>
        </div>
        <span className="text-muted-foreground">
          {startingTailscale
            ? "Starting Tailscale…"
            : status === "open"
              ? cfg.endpoint
              : status === "connecting"
                ? "connecting…"
                : "disconnected — retrying…"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={handleForget}>
          Change device
        </Button>
      </div>

      {tailscaleError && (
        <div className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {tailscaleError}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {!snapshot ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {status === "closed" ? "Reconnecting…" : "Loading boards and tasks…"}
          </div>
        ) : view === "board" ? (
          <BoardView snapshot={snapshot} api={api} />
        ) : (
          <ScheduleView snapshot={snapshot} api={api} />
        )}
      </div>
    </div>
  );
}

function ConnectionSetup({
  onConnected,
}: {
  onConnected: (cfg: DashboardEndpoint) => void;
}) {
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startingTailscale, setStartingTailscale] = useState(false);

  const submit = useCallback(async () => {
    const cfg = { endpoint: endpoint.trim(), token: token.trim() };
    if (!cfg.endpoint || !cfg.token) return;
    setBusy(true);
    setError(null);
    try {
      await ensureTailscaleUp(() => setStartingTailscale(true));
      setStartingTailscale(false);
      const res = await fetch(`http://${cfg.endpoint}/api/boards`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) throw new Error(`Server replied ${res.status} — check the token.`);
      saveEndpoint(cfg);
      onConnected(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach that endpoint.");
    } finally {
      setBusy(false);
      setStartingTailscale(false);
    }
  }, [endpoint, token, onConnected]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background p-6">
      <HugeiconsIcon icon={KanbanIcon} size={32} strokeWidth={1.5} className="text-muted-foreground" />
      <div className="text-sm text-muted-foreground">
        Enter the endpoint and token from DashboardPlusPlus → Settings → Desktop sync.
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        <Input
          value={endpoint}
          placeholder="tailnet-ip:8787"
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <Input
          value={token}
          placeholder="token"
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <Button disabled={busy || !endpoint.trim() || !token.trim()} onClick={() => void submit()}>
          {startingTailscale ? "Starting Tailscale…" : busy ? "Connecting…" : "Connect"}
        </Button>
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    </div>
  );
}
