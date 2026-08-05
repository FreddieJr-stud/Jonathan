import { create } from "zustand";
import type {
  DashboardApi,
  DashboardEndpoint,
  Snapshot,
  SyncStatus,
} from "../lib/dashboardClient";

/**
 * Dashboard sync state, shared by every consumer (Dashboard tab, Pomodoro
 * timer, ...). Connection lifecycle (the WebSocket + reconnect loop) lives in
 * `useDashboardSyncLifecycle`, mounted once at the app shell — this store is
 * just the data those effects write into, so any component can read the
 * current snapshot without owning a connection itself.
 */
export type DashboardSyncState = {
  cfg: DashboardEndpoint | null;
  snapshot: Snapshot | null;
  status: SyncStatus;
  api: DashboardApi | null;
  startingTailscale: boolean;
  tailscaleError: string | null;
  setCfg: (cfg: DashboardEndpoint | null) => void;
  setSnapshot: (snapshot: Snapshot | null) => void;
  setStatus: (status: SyncStatus) => void;
  setApi: (api: DashboardApi | null) => void;
  setStartingTailscale: (startingTailscale: boolean) => void;
  setTailscaleError: (tailscaleError: string | null) => void;
};

export const useDashboardSyncStore = create<DashboardSyncState>((set) => ({
  cfg: null,
  snapshot: null,
  status: "connecting",
  api: null,
  startingTailscale: false,
  tailscaleError: null,
  setCfg: (cfg) => set({ cfg }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setStatus: (status) => set({ status }),
  setApi: (api) => set({ api }),
  setStartingTailscale: (startingTailscale) => set({ startingTailscale }),
  setTailscaleError: (tailscaleError) => set({ tailscaleError }),
}));
