import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { useAgentStore } from "@/modules/agents";
import { useSpaces } from "@/modules/spaces";
import { DEFAULT_SPACE_ID } from "@/modules/tabs";
import { disposeSession, respawnSession, writeToSession } from "@/modules/terminal";
import { toast } from "sonner";
import { create } from "zustand";

// The Claude buddy is a frameless, always-on-top (within terax) overlay that
// hosts one or more real `claude` CLI instances, each in its own PTY. It exists
// because Claude Code's TUI repaints/wraps to the *current* width: inside a
// split pane the repeated reflow mangles the transcript. The buddy has stable,
// self-owned geometry, so that reflow path never runs.
//
// Instances are scoped per space: each space has its own set of buddy tabs.
// Switching spaces swaps which tabs are shown, but every instance's PTY stays
// alive (the overlay keeps them all mounted, just hidden), so a background
// space's Claude keeps running. Each instance gets a stable negative leafId so
// it never collides with the positive leafIds the tab system hands out. The
// instance *list* is persisted to localStorage per space; PTYs die on app exit,
// so on relaunch each restored instance auto-runs `claude --resume <uuid>`.

const STORE_KEY = "terax-buddy-instances";
const SKIP = "--dangerously-skip-permissions";

export type BuddyInstance = {
  /** Stable, persisted identity. */
  id: string;
  /** Space this instance belongs to. */
  spaceId: string;
  /** Runtime PTY/terminal-session id (negative, regenerated each launch). */
  leafId: number;
  /**
   * Claude Code conversation UUID owned by this instance. We pass it as
   * `--session-id` on first launch and `--resume <uuid>` afterwards, so the
   * buddy always resumes *its own* conversation. `claude --continue` would
   * instead grab the most-recent conversation in the cwd — which, since the
   * buddy shares its project dir with CLI runs and sibling instances, is
   * frequently an unrelated session.
   */
  sessionId: string;
  /** cwd Claude runs in (from the focused terminal pane at spawn time). */
  cwd: string | null;
  /** Short label for the tab (last path segment). */
  title: string;
  /** PTY spawned + `claude` command sent this session. */
  spawned: boolean;
  /** Restored from disk → launch with `--continue` to resume the conversation. */
  resume: boolean;
  /** PTY process exited. */
  exited: boolean;
};

export type SpaceBuddy = {
  /** Overlay is visible / interactive (for this space). */
  open: boolean;
  instances: BuddyInstance[];
  activeId: string | null;
};

let nextLeafId = -1000;
const allocLeaf = () => nextLeafId--;

let seq = 0;
const allocId = () => `buddy-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// A valid UUID for Claude's `--session-id`. crypto.randomUUID exists in the
// Tauri webview; the fallback keeps types honest if it's ever absent.
function allocSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    return `${h()}${h()}-${h()}-4${h().slice(1)}-8${h().slice(1)}-${h()}${h()}${h()}`;
  }
}

function curSpace(): string {
  return useSpaces.getState().activeId ?? DEFAULT_SPACE_ID;
}

// Same directory? Normalizes separators + trailing slash, case-insensitive
// (Windows paths). Used to match Ctrl+Shift+J to an existing instance.
function sameDir(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  const n = (p: string) =>
    p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return n(a) === n(b);
}

function titleFor(cwd: string | null): string {
  if (!cwd) return "claude";
  return (
    cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? "claude"
  );
}

// Claude Code stores each conversation at
// ~/.claude/projects/<enc(cwd)>/<sessionId>.jsonl, where the project folder is
// the cwd with every non-alphanumeric char replaced by "-" (verified against
// real folders, e.g. `C:\Users\frpag\projects` -> `C--Users-frpag-projects`).
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Does a saved conversation actually exist for this instance? A session file is
 * only written once Claude takes its first turn, so an instance that was spawned
 * but never chatted has no file — `--resume <id>` on it errors with
 * "No conversation found with session ID". We check first so we can launch fresh
 * (pinned to the same id) instead.
 */
async function sessionFileExists(
  cwd: string | null,
  sessionId: string,
): Promise<boolean> {
  if (!cwd || !sessionId) return false;
  try {
    const path = await join(
      await homeDir(),
      ".claude",
      "projects",
      encodeProjectDir(cwd),
      `${sessionId}.jsonl`,
    );
    // fs_stat rejects when the path is missing; resolving means it exists.
    await invoke("fs_stat", { path });
    return true;
  } catch {
    return false;
  }
}

/** Resume an instance's own conversation by its session UUID. */
async function resumeCmd(inst: BuddyInstance): Promise<string> {
  if (inst.sessionId) {
    return (await sessionFileExists(inst.cwd, inst.sessionId))
      ? `claude --resume ${inst.sessionId} ${SKIP}\r`
      : // Pinned but nothing saved yet (never chatted, or cwd unknown): start a
        // fresh conversation on the same id so the next resume finds it.
        `claude --session-id ${inst.sessionId} ${SKIP}\r`;
  }
  // Legacy instance with no UUID — best effort. Bare --resume opens Claude's
  // interactive session picker instead of silently grabbing the latest one.
  return `claude --resume ${SKIP}\r`;
}

/** Command that launches Claude in a freshly-spawned shell. */
export async function buddyLaunchCmd(inst: BuddyInstance): Promise<string> {
  if (inst.resume) return resumeCmd(inst);
  // Pin the new conversation to our UUID so we can resume exactly it later.
  return inst.sessionId
    ? `claude --session-id ${inst.sessionId} ${SKIP}\r`
    : `claude ${SKIP}\r`;
}

function makeInstance(
  cwd: string | null,
  spaceId: string,
  resume: boolean,
): BuddyInstance {
  return {
    id: allocId(),
    spaceId,
    leafId: allocLeaf(),
    sessionId: allocSessionId(),
    cwd,
    title: titleFor(cwd),
    spawned: false,
    resume,
    exited: false,
  };
}

const emptySpace = (): SpaceBuddy => ({ open: false, instances: [], activeId: null });

type Persisted = {
  bySpace: Record<
    string,
    {
      instances: {
        id: string;
        cwd: string | null;
        title: string;
        sessionId?: string;
      }[];
      activeId: string | null;
    }
  >;
};

function load(): Record<string, SpaceBuddy> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Persisted;
      const bySpace: Record<string, SpaceBuddy> = {};
      for (const [sid, sb] of Object.entries(p.bySpace ?? {})) {
        const instances = (sb.instances ?? []).map<BuddyInstance>((i) => ({
          id: i.id,
          spaceId: sid,
          leafId: allocLeaf(),
          // Legacy entries (pre-sessionId) get a fresh UUID so each instance
          // resumes its *own* conversation. Without this they'd all fall back to
          // `claude --continue` and collide on the cwd's most-recent session.
          sessionId: i.sessionId || allocSessionId(),
          cwd: i.cwd ?? null,
          title: i.title || titleFor(i.cwd ?? null),
          spawned: false,
          resume: true, // restored → resume the prior conversation
          exited: false,
        }));
        const activeId = instances.some((i) => i.id === sb.activeId)
          ? sb.activeId
          : (instances[0]?.id ?? null);
        bySpace[sid] = { open: false, instances, activeId };
      }
      return bySpace;
    }
  } catch {
    // corrupt entry — start empty
  }
  return {};
}

type Store = {
  bySpace: Record<string, SpaceBuddy>;
  /** Shortcut handler: show/hide the current space's buddy; first open spawns one. */
  toggle: (cwd: string | null) => void;
  /** Spawn a new instance in the current space at `cwd` and focus it. */
  newInstance: (cwd: string | null) => void;
  closeInstance: (id: string) => void;
  /** Close the current space's active instance entirely (Ctrl+W in the buddy). */
  closeActive: () => void;
  setActive: (id: string) => void;
  /** Select an instance and show the overlay focused on it. */
  focusInstance: (id: string) => void;
  /** Cycle to the next instance in the current space (wraps) and show the overlay. */
  cycleInstance: () => void;
  /** Restart + resume Claude in the current space's active instance (Ctrl+Shift+R). */
  restartActive: () => void;
  markSpawned: (id: string) => void;
  setExited: (id: string) => void;
};

export const useBuddyStore = create<Store>((set, get) => {
  const persist = () => save(get().bySpace);

  function save(bySpace: Record<string, SpaceBuddy>) {
    try {
      const data: Persisted = { bySpace: {} };
      for (const [sid, sb] of Object.entries(bySpace)) {
        if (sb.instances.length === 0) continue;
        data.bySpace[sid] = {
          instances: sb.instances.map((i) => ({
            id: i.id,
            cwd: i.cwd,
            title: i.title,
            sessionId: i.sessionId,
          })),
          activeId: sb.activeId,
        };
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      // private mode / quota — the list just won't persist
    }
  }

  // Apply a transform to the current space's slice and persist.
  const mutateCur = (fn: (sb: SpaceBuddy) => SpaceBuddy) =>
    set((s) => {
      const sid = curSpace();
      const cur = s.bySpace[sid] ?? emptySpace();
      return { bySpace: { ...s.bySpace, [sid]: fn(cur) } };
    });

  // Find the space + instance for a global instance id (works across spaces, so
  // a background space's instance can mark itself spawned/exited).
  const mutateInstance = (
    id: string,
    fn: (inst: BuddyInstance) => BuddyInstance,
  ) =>
    set((s) => {
      const bySpace = { ...s.bySpace };
      for (const [sid, sb] of Object.entries(bySpace)) {
        if (sb.instances.some((i) => i.id === id)) {
          bySpace[sid] = {
            ...sb,
            instances: sb.instances.map((i) => (i.id === id ? fn(i) : i)),
          };
          break;
        }
      }
      return { bySpace };
    });

  return {
    bySpace: load(),

    toggle: (cwd) => {
      const sid = curSpace();
      const cur = get().bySpace[sid] ?? emptySpace();

      // No directory context (not a terminal): plain show/hide of the active
      // instance, creating one only if none exist.
      if (cwd == null) {
        if (cur.open) mutateCur((sb) => ({ ...sb, open: false }));
        else if (cur.instances.length > 0)
          mutateCur((sb) => ({ ...sb, open: true }));
        else {
          const inst = makeInstance(null, sid, false);
          mutateCur(() => ({
            open: true,
            instances: [inst],
            activeId: inst.id,
          }));
          persist();
        }
        return;
      }

      // cwd-aware: match an existing instance for this directory.
      const match = cur.instances.find((i) => sameDir(i.cwd, cwd));

      // Already showing this directory's instance → minimize (toggle off).
      if (cur.open && match && cur.activeId === match.id) {
        mutateCur((sb) => ({ ...sb, open: false }));
        return;
      }
      // Match exists elsewhere/hidden → focus it.
      if (match) {
        mutateCur((sb) => ({ ...sb, open: true, activeId: match.id }));
        persist();
        return;
      }
      // No instance for this directory → spawn a fresh one.
      const inst = makeInstance(cwd, sid, false);
      mutateCur((sb) => ({
        open: true,
        instances: [...sb.instances, inst],
        activeId: inst.id,
      }));
      persist();
    },

    newInstance: (cwd) => {
      const sid = curSpace();
      const inst = makeInstance(cwd, sid, false);
      mutateCur((sb) => ({
        open: true,
        instances: [...sb.instances, inst],
        activeId: inst.id,
      }));
      persist();
    },

    closeInstance: (id) => {
      const sid = curSpace();
      const inst = get().bySpace[sid]?.instances.find((i) => i.id === id);
      if (inst) {
        disposeSession(inst.leafId);
        useAgentStore.getState().finish(inst.leafId);
      }
      mutateCur((sb) => {
        const instances = sb.instances.filter((i) => i.id !== id);
        const activeId =
          sb.activeId === id
            ? (instances[instances.length - 1]?.id ?? null)
            : sb.activeId;
        return { ...sb, instances, activeId };
      });
      persist();
    },

    closeActive: () => {
      const cur = get().bySpace[curSpace()];
      if (cur?.activeId) get().closeInstance(cur.activeId);
    },

    setActive: (id) => {
      mutateCur((sb) => ({ ...sb, activeId: id }));
      persist();
    },

    focusInstance: (id) => {
      mutateCur((sb) => ({ ...sb, activeId: id, open: true }));
      persist();
    },

    cycleInstance: () => {
      const sid = curSpace();
      const cur = get().bySpace[sid];
      if (!cur || cur.instances.length === 0) return;
      const i = cur.instances.findIndex((x) => x.id === cur.activeId);
      const next = cur.instances[(i + 1) % cur.instances.length];
      mutateCur((sb) => ({ ...sb, activeId: next.id, open: true }));
      persist();
    },

    restartActive: () => {
      const sid = curSpace();
      const cur = get().bySpace[sid];
      const inst = cur?.instances.find((i) => i.id === cur.activeId);
      if (!inst) return;
      // Why: Claude Code hard-wraps its transcript to the live width; a fresh
      // shell + `--resume` reprints it cleanly. Mirrors restartResumeAgent, but
      // resumes this instance's own tracked session UUID when one exists.
      toast("Restarting Claude and resuming the conversation…");
      const leafId = inst.leafId;
      void respawnSession(leafId, inst.cwd ?? undefined).then(async () => {
        // respawn kills the pty (an `exited` signal removes the agent session);
        // re-register so the state dot keeps tracking the new process.
        const agents = useAgentStore.getState();
        agents.start(leafId, leafId, "claude");
        agents.setStatus(leafId, "idle");
        writeToSession(leafId, await resumeCmd({ ...inst, resume: true }));
      });
      mutateInstance(inst.id, (i) => ({ ...i, exited: false, resume: true }));
    },

    markSpawned: (id) => mutateInstance(id, (i) => ({ ...i, spawned: true })),
    setExited: (id) => mutateInstance(id, (i) => ({ ...i, exited: true })),
  };
});
