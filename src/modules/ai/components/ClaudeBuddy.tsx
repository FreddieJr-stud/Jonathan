import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/modules/agents";
import { useSpaces } from "@/modules/spaces";
import { DEFAULT_SPACE_ID } from "@/modules/tabs";
import {
  TerminalPane,
  type TerminalPaneHandle,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import { Cancel01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { useComposer } from "../lib/composer";
import type { ResizeDir } from "../lib/miniWindowGeometry";
import { useBuddyGeometry } from "../lib/useBuddyGeometry";
import { type BuddyInstance, buddyLaunchCmd, useBuddyStore } from "../store/buddyStore";

const GEOM_KEY = "terax-ui-buddy-geom";

const RESIZE_HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-3 right-3 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
  e: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

// Last three path segments, e.g. "\Fred_Vault\Fred_s Vault\Last_semester".
function shortPath(cwd: string | null): string | null {
  if (!cwd) return null;
  const segs = cwd
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return `\\${segs.slice(-3).join("\\")}`;
}

export function ClaudeBuddy() {
  const spaceId = useSpaces((s) => s.activeId) ?? DEFAULT_SPACE_ID;
  const curOpen = useBuddyStore((s) => s.bySpace[spaceId]?.open ?? false);
  // Keep mounted (PTYs alive) while ANY space has instances, even while hidden,
  // so switching spaces — or reopening — never kills a Claude. Render nothing
  // only when no space has an instance and the current space isn't open.
  const anyInstances = useBuddyStore((s) =>
    Object.values(s.bySpace).some((sb) => sb.instances.length > 0),
  );
  if (!curOpen && !anyInstances) return null;
  return <BuddyWindow spaceId={spaceId} />;
}

function BuddyWindow({ spaceId }: { spaceId: string }) {
  const bySpace = useBuddyStore((s) => s.bySpace);
  const toggle = useBuddyStore((s) => s.toggle);

  const cur = bySpace[spaceId];
  const open = cur?.open ?? false;
  const activeId = cur?.activeId ?? null;
  const curInstances = cur?.instances ?? [];
  // Mount only spaces actually visited this session, so a background space's
  // PTY survives a *later* space switch without every persisted instance
  // across every space cold-launching `claude --resume` (+ its own MCP
  // server subprocess tree) simultaneously at boot. First render already
  // includes the initial active space; switching spaces warms the new one.
  const [warmedSpaces, setWarmedSpaces] = useState<Set<string>>(
    () => new Set([spaceId]),
  );
  useEffect(() => {
    setWarmedSpaces((prev) => (prev.has(spaceId) ? prev : new Set(prev).add(spaceId)));
  }, [spaceId]);
  const allInstances = Object.values(bySpace)
    .flatMap((sb) => sb.instances)
    .filter((i) => warmedSpaces.has(i.spaceId));
  const active = curInstances.find((i) => i.id === activeId) ?? null;

  const { ref, onHeaderPointerDown, startResize } = useBuddyGeometry(
    GEOM_KEY,
    open,
  );

  return (
    <div
      ref={ref}
      data-claude-buddy
      style={{
        visibility: open ? "visible" : "hidden",
        pointerEvents: open ? "auto" : "none",
      }}
      className={cn(
        "no-scrollbar-deep fixed z-40 flex flex-col overflow-hidden",
        "rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl text-[12px]",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_24px_48px_-12px_rgba(0,0,0,0.45),0_8px_16px_-8px_rgba(0,0,0,0.3)]",
        "ring-1 ring-black/5 dark:ring-white/5",
      )}
    >
      {RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} dir={dir} onPointerDown={startResize(dir)} />
      ))}

      <Header
        cwd={active?.cwd ?? null}
        onClose={() => toggle(null)}
        onHeaderPointerDown={onHeaderPointerDown}
      />

      <div className="relative min-h-0 flex-1">
        {allInstances.map((inst) => {
          const visible =
            open && inst.spaceId === spaceId && inst.id === activeId;
          return (
            <div
              key={inst.id}
              className="absolute inset-0"
              style={{ zIndex: visible ? 1 : 0 }}
            >
              <BuddyInstancePane inst={inst} active={visible} />
            </div>
          );
        })}
        {curInstances.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            No Claude instances — use the + in the status bar to start one.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BuddyInstancePane({
  inst,
  active,
}: {
  inst: BuddyInstance;
  active: boolean;
}) {
  const markSpawned = useBuddyStore((s) => s.markSpawned);
  const setExited = useBuddyStore((s) => s.setExited);
  const paneRef = useRef<TerminalPaneHandle>(null);
  const launched = useRef(false);
  const composer = useComposer();

  // Launch Claude once, after the PTY attaches. writeToSession queues input
  // until the pty is ready, but waiting avoids racing the shell's first prompt.
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    let cancelled = false;
    void whenSessionReady(inst.leafId).then(async () => {
      if (cancelled) return;
      // Register a session so the OSC-fed agent signals (working/waiting/idle/
      // done) update the state dot. The bridge's own `started` path needs the
      // leaf to live in a terminal tab; the buddy has no tab, so we seed it here
      // (synthetic tabId = leafId). Starts idle until Claude reports activity.
      const agents = useAgentStore.getState();
      agents.start(inst.leafId, inst.leafId, "claude");
      agents.setStatus(inst.leafId, "idle");
      const cmd = await buddyLaunchCmd(inst);
      if (cancelled) return;
      writeToSession(inst.leafId, cmd);
      markSpawned(inst.id);
    });
    return () => {
      cancelled = true;
    };
  }, [inst, markSpawned]);

  // All typing goes through the bottom composer bar — this pane is
  // output/scrollback only (clicking to select text still works normally).
  // xterm still grabs its hidden textarea's focus on mousedown; the moment it
  // does, bounce focus back to the composer instead of leaving it stuck here.
  return (
    <div
      className="size-full"
      onFocusCapture={() => composer.textareaRef.current?.focus()}
    >
      <TerminalPane
        ref={paneRef}
        leafId={inst.leafId}
        spaceId={inst.spaceId}
        visible={active}
        focused={false}
        initialCwd={inst.cwd ?? undefined}
        blocks={false}
        onExit={() => setExited(inst.id)}
      />
    </div>
  );
}

function ResizeHandle({
  dir,
  onPointerDown,
}: {
  dir: ResizeDir;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-no-drag
      onPointerDown={onPointerDown}
      className={cn("absolute z-50 touch-none select-none", RESIZE_HANDLE_CLASS[dir])}
    />
  );
}

function Header({
  cwd,
  onClose,
  onHeaderPointerDown,
}: {
  cwd: string | null;
  onClose: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  const path = shortPath(cwd);
  return (
    <div
      onPointerDown={onHeaderPointerDown}
      className="relative flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border/60 px-3 active:cursor-grabbing"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <HugeiconsIcon
          icon={SparklesIcon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 text-[11px] font-medium text-foreground">
          Claude buddy
        </span>
        {path ? (
          <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
            · {path}
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onClose}
        className="size-5"
        aria-label="Close"
        title="Close (Ctrl+Shift+J)"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
      </Button>
    </div>
  );
}
