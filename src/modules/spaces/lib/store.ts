import { LazyStore } from "@tauri-apps/plugin-store";
import { getLaunchDir } from "@/lib/launchDir";
import { storeSuffix } from "@/lib/storeScope";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SerializedTab } from "./serialize";

export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  /** Opt-in accent, index into SPACE_COLORS. Undefined = theme primary. */
  color?: number;
  createdAt: number;
  updatedAt: number;
};

export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
};

const KEY_SPACES = "spaces";
const KEY_ACTIVE = "activeId";
const STATE_PREFIX = "state:";
const stateKey = (id: string) => `${STATE_PREFIX}${id}`;

// Lazy so the store file name can depend on getLaunchDir(), which is only
// resolved once initLaunchDir() settles in main.tsx (before this module's
// exports are ever called, but after module load). One process can now host
// multiple project windows (single-instance); each window is its own webview
// with its own JS module instance, so this per-window suffix is all that's
// needed to keep their spaces from colliding on disk.
let store: LazyStore | null = null;
function getStore(): LazyStore {
  if (!store) {
    const path = `terax-spaces${storeSuffix(getLaunchDir())}.json`;
    store = new LazyStore(path, { defaults: {}, autoSave: 500 });
  }
  return store;
}

export type LoadedSpaces = {
  spaces: SpaceMeta[];
  activeId: string | null;
  states: Map<string, SpaceState>;
};

export async function loadAll(): Promise<LoadedSpaces> {
  const entries = await getStore().entries();
  let spaces: SpaceMeta[] = [];
  let activeId: string | null = null;
  const states = new Map<string, SpaceState>();
  for (const [k, v] of entries) {
    if (k === KEY_SPACES) spaces = (v as SpaceMeta[]) ?? [];
    else if (k === KEY_ACTIVE) activeId = (v as string | null) ?? null;
    else if (k.startsWith(STATE_PREFIX)) {
      states.set(k.slice(STATE_PREFIX.length), v as SpaceState);
    }
  }
  return { spaces, activeId, states };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  await getStore().set(KEY_SPACES, spaces);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await getStore().set(KEY_ACTIVE, id);
}

export async function saveState(id: string, state: SpaceState): Promise<void> {
  await getStore().set(stateKey(id), state);
}

export async function deleteSpaceData(id: string): Promise<void> {
  await getStore().delete(stateKey(id));
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
