import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createDashboardApi,
  loadEndpoint,
  subscribeSnapshot,
  type BoardDto,
  type DashboardApi,
} from "./dashboardClient";
import { pickBackfillColors } from "./taskColors";
import { useDashboardSyncStore } from "../store/dashboardSyncStore";

const RECONNECT_DELAY_MS = 3_000;

/** Brings the Tailscale daemon up if it isn't already running. No-op (and silent) if it's already up. */
export async function ensureTailscaleUp(onStarting?: () => void): Promise<void> {
  const state = await invoke<string>("tailscale_status");
  if (state === "Running") return;
  onStarting?.();
  await invoke("tailscale_up");
}

/**
 * Assigns+persists a color for any board synced with a null colorArgb (e.g.
 * boards created before per-board colors existed, or from a client that
 * doesn't set one). `pending` tracks in-flight board IDs across snapshots so
 * a snapshot arriving mid-update can't re-pick the same board and double-fire.
 */
async function backfillMissingColors(
  api: DashboardApi,
  boards: BoardDto[],
  pending: Set<number>,
): Promise<void> {
  const candidates = boards.filter((b) => !pending.has(b.id));
  const toAssign = pickBackfillColors(candidates);
  if (toAssign.size === 0) return;

  for (const id of toAssign.keys()) pending.add(id);

  await Promise.all(
    Array.from(toAssign, async ([id, colorArgb]) => {
      const board = boards.find((b) => b.id === id);
      if (!board) {
        pending.delete(id);
        return;
      }
      try {
        await api.updateBoard(id, { name: board.name, position: board.position, colorArgb });
      } finally {
        pending.delete(id);
      }
    }),
  );
}

/**
 * Owns the dashboard sync connection lifecycle at the app shell level, so it
 * survives whether or not the Dashboard tab is open. Mounted once via
 * `<DashboardSyncBridge />`; everything else reads `useDashboardSyncStore`.
 */
export function useDashboardSyncLifecycle(): void {
  const cfg = useDashboardSyncStore((s) => s.cfg);
  const setCfg = useDashboardSyncStore((s) => s.setCfg);
  const setSnapshot = useDashboardSyncStore((s) => s.setSnapshot);
  const setStatus = useDashboardSyncStore((s) => s.setStatus);
  const setApi = useDashboardSyncStore((s) => s.setApi);
  const setStartingTailscale = useDashboardSyncStore((s) => s.setStartingTailscale);
  const setTailscaleError = useDashboardSyncStore((s) => s.setTailscaleError);

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const backfillingRef = useRef<Set<number>>(new Set());

  // Load any previously-saved endpoint on first mount.
  useEffect(() => {
    setCfg(loadEndpoint());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cfg) {
      setApi(null);
      return;
    }
    setSnapshot(null);
    setTailscaleError(null);
    let cancelled = false;
    const api = createDashboardApi(cfg);
    setApi(api);
    void ensureTailscaleUp(() => !cancelled && setStartingTailscale(true))
      .catch((e) => {
        if (!cancelled) setTailscaleError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setStartingTailscale(false);
      });
    const unsubscribe = subscribeSnapshot(
      cfg,
      (snap) => {
        setSnapshot(snap);
        void backfillMissingColors(api, snap.boards, backfillingRef.current);
      },
      (s) => {
        setStatus(s);
        if (s === "closed") {
          reconnectTimer.current = setTimeout(
            () => setReconnectNonce((n) => n + 1),
            RECONNECT_DELAY_MS,
          );
        }
      },
    );
    return () => {
      cancelled = true;
      backfillingRef.current.clear();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      unsubscribe();
    };
    // reconnectNonce forces a fresh connection attempt after a drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, reconnectNonce]);
}

/** Mounted once at the app shell to keep dashboard sync alive independent of the Dashboard tab. */
export function DashboardSyncBridge() {
  useDashboardSyncLifecycle();
  return null;
}
