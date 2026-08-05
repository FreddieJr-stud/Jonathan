import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useShortcutLabel } from "@/modules/shortcuts";
import { leafIds } from "@/modules/terminal/lib/panes";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  ComputerTerminal02Icon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  KanbanIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { agentColorForTab } from "./lib/agentTabColor";
import { TAB_COLORS, tabColorVar } from "./lib/tabColors";
import { labelFor } from "./lib/tabLabel";
import type { EditorTab, Tab, TabColor } from "./lib/useTabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  /** Open the dashboard (task board) client tab. */
  onOpenDashboard: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Set a tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Set a tab's accent color; "" clears it. */
  onColor: (id: number, color: TabColor | "") => void;
  /** Move a dragged tab to a new position (insertion gap index 0..tabs.length). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  /** Dock a tab into the active tab's split, in the given direction. */
  onSplit?: (targetId: number, dir: "row" | "col") => void;
  /** The active tab can still accept another pane (under the cap). */
  canSplit?: boolean;
  /** All tabs of the space (incl. docked members) to resolve group segments. */
  paneTabs?: Tab[];
  /** Focus a pane within a split group (clicking a segment). */
  onFocusPane?: (hostId: number, memberId: number) => void;
};

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onOpenDashboard,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onRename,
  onColor,
  onReorder,
  onSplit,
  canSplit,
  paneTabs,
  onFocusPane,
}: Props) {
  // Read the live bindings rather than hardcoding key text: these drift as
  // defaults move between actions, and users can rebind them in Settings.
  const newTabKeys = useShortcutLabel("tab.new");
  const dashboardKeys = useShortcutLabel("tab.dashboardClient");
  const privateKeys = useShortcutLabel("tab.newPrivate");
  const editorKeys = useShortcutLabel("tab.newEditor");
  const previewKeys = useShortcutLabel("tab.newPreview");

  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    fromId: number;
    active: boolean;
  } | null>(null);

  // Play the enter animation only for tabs opened after the first paint, never
  // the restored set and never on switch/reorder (triggers are keyed, so they
  // don't remount then). The ref is seeded with the initial ids on first render.
  const seenRef = useRef<Set<number> | null>(null);
  const firstRender = seenRef.current === null;
  let seen = seenRef.current;
  if (seen === null) {
    seen = new Set(tabs.map((t) => t.id));
    seenRef.current = seen;
  }
  useEffect(() => {
    seenRef.current = new Set(tabs.map((t) => t.id));
  }, [tabs]);

  // Live agent sessions drive the accent bar: while a tab has a running session
  // its status color overrides the manual one, reverting when the session ends.
  const sessions = useAgentStore((s) => s.sessions);

  const gapAtY = (clientY: number) => {
    const els = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
    );
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return els.length;
  };

  const endDrag = (currentTarget: HTMLElement) => {
    const st = drag.current;
    if (st) currentTarget.releasePointerCapture?.(st.pointerId);
    drag.current = null;
    setDraggingId(null);
    setDropGap(null);
    document.body.style.userSelect = "";
  };

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border/60 px-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Tabs</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New tab"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-52"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuItem onSelect={() => onNew()}>
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Terminal</span>
              <ItemKeys keys={newTabKeys} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenDashboard()}>
              <HugeiconsIcon icon={KanbanIcon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Tasks</span>
              <ItemKeys keys={dashboardKeys} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewPrivate()}>
              <HugeiconsIcon
                icon={IncognitoIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Privacy</span>
              <ItemKeys keys={privateKeys} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewEditor()}>
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Editor</span>
              <ItemKeys keys={editorKeys} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewPreview()}>
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Preview</span>
              <ItemKeys keys={previewKeys} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewGitGraph()}>
              <HugeiconsIcon
                icon={GitBranchIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Git Graph</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <Tabs
          orientation="vertical"
          value={String(activeId)}
          onValueChange={(v) => onSelect(Number(v))}
        >
          <TabsList className="h-fit w-full flex-col gap-0.5 rounded-none bg-transparent p-0">
            {tabs.map((t, i) => {
              const isPreview = t.kind === "editor" && (t as EditorTab).preview;
              const isActive = t.id === activeId;
              // Auto (agent) color wins while a session runs; else manual color.
              const effectiveColor =
                agentColorForTab(sessions, t.id) ?? t.color;
              const isNew = !firstRender && !seen.has(t.id);
              // Pane (tab) ids of this tab's split group, if it's a host.
              const panes = t.group ? leafIds(t.group) : null;
              // When the row represents a split group, its icon/label reflect
              // whichever pane currently has focus within that group.
              const focusedTab = panes
                ? (paneTabs?.find((x) => x.id === (t.groupFocus ?? t.id)) ?? t)
                : t;

              const srcIndex = tabs.findIndex((x) => x.id === draggingId);
              const showGap = (gap: number) =>
                draggingId !== null &&
                dropGap === gap &&
                gap !== srcIndex &&
                gap !== srcIndex + 1;

              // While renaming, render a non-button cell so the <input> is not
              // nested inside the trigger <button> (invalid HTML, and WebKit
              // blocks focus/selection on inputs inside buttons).
              if (editingId === t.id) {
                return (
                  <Fragment key={t.id}>
                    {showGap(i) && <DropIndicator />}
                    <div
                      data-tab-id={t.id}
                      className="relative flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2 text-xs text-foreground"
                    >
                      <AccentBar color={effectiveColor} />
                      <TabIcon tab={focusedTab} />
                      <TabRenameInput
                        initial={labelFor(t)}
                        onCommit={(value) => {
                          onRename(t.id, value);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                    {i === tabs.length - 1 && showGap(tabs.length) && (
                      <DropIndicator />
                    )}
                  </Fragment>
                );
              }

              const trigger = (
                <TabsTrigger
                  value={String(t.id)}
                  data-tab-id={t.id}
                  data-tab-active={isActive ? "true" : undefined}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest("[data-no-drag]"))
                      return;
                    drag.current = {
                      pointerId: e.pointerId,
                      startY: e.clientY,
                      fromId: t.id,
                      active: false,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const st = drag.current;
                    if (!st || st.pointerId !== e.pointerId) return;
                    if (!st.active) {
                      if (Math.abs(e.clientY - st.startY) < 4) return;
                      st.active = true;
                      setDraggingId(st.fromId);
                      document.body.style.userSelect = "none";
                    }
                    e.preventDefault();
                    setDropGap(gapAtY(e.clientY));
                  }}
                  onPointerUp={(e) => {
                    const st = drag.current;
                    if (st?.active && dropGap !== null) {
                      onReorder(st.fromId, dropGap);
                    } else if (st && !st.active) {
                      onSelect(t.id);
                    }
                    endDrag(e.currentTarget);
                  }}
                  onPointerCancel={(e) => endDrag(e.currentTarget)}
                  onDoubleClick={() =>
                    isPreview ? onPin(t.id) : setEditingId(t.id)
                  }
                  onAuxClick={(e) => {
                    if (e.button === 1 && tabs.length > 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      onClose(t.id);
                    }
                  }}
                  // Suppress Radix's switch-on-mousedown so a tab grabbed to
                  // drag (or a plain click) only activates on release.
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      return;
                    }
                    if (
                      e.button === 0 &&
                      !(e.target as HTMLElement).closest("[data-no-drag]")
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className={cn(
                    "group relative z-[1] h-fit w-full shrink-0 items-start justify-start gap-1.5 rounded-md bg-transparent px-2 py-1.5 text-xs transition-colors data-active:bg-foreground/[0.07] dark:data-active:bg-foreground/[0.09]",
                    isNew && "terax-tab-in",
                    isActive
                      ? "text-foreground dark:text-foreground"
                      : "text-muted-foreground hover:text-foreground/80 dark:text-muted-foreground",
                    draggingId === t.id && "opacity-50",
                  )}
                >
                  <AccentBar color={effectiveColor} />
                  <TabIcon tab={focusedTab} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 whitespace-normal break-words text-left",
                      isPreview && "italic",
                    )}
                  >
                    {labelFor(t)}
                  </span>
                  {t.kind === "editor" && t.dirty ? (
                    <span
                      aria-label="Unsaved changes"
                      className="mt-1 size-1.5 shrink-0 rounded-full bg-foreground/70"
                    />
                  ) : null}
                  {tabs.length > 1 && (
                    <span
                      role="button"
                      aria-label="Close tab"
                      data-no-drag
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(t.id);
                      }}
                      className="mt-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-60"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={11}
                        strokeWidth={2}
                      />
                    </span>
                  )}
                </TabsTrigger>
              );

              // Split options dock this tab into the active tab's view, so they
              // only make sense on a non-active tab when the host has room.
              const canSplitHere =
                !!onSplit && !!canSplit && !isActive && tabs.length > 1;
              // Rename + color apply to every visible tab, so the menu is always
              // present.

              const tabNode = (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-40 p-1"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <ContextMenuItem
                      className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                      onSelect={() => setEditingId(t.id)}
                    >
                      <HugeiconsIcon
                        icon={PencilEdit02Icon}
                        size={13}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Rename</span>
                    </ContextMenuItem>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                      {TAB_COLORS.map((c) => (
                        <ContextMenuItem
                          key={c.id}
                          onSelect={() => onColor(t.id, c.id)}
                          title={c.label}
                          aria-label={c.label}
                          className={cn(
                            "size-5 shrink-0 rounded-full p-0 ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-ring",
                            t.color === c.id && "ring-2 ring-foreground/60",
                          )}
                          style={{ background: c.var }}
                        />
                      ))}
                      <ContextMenuItem
                        onSelect={() => onColor(t.id, "")}
                        title="Clear color"
                        aria-label="Clear color"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full p-0 ring-1 ring-inset ring-foreground/15 focus:ring-2 focus:ring-ring"
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={11}
                          strokeWidth={2}
                        />
                      </ContextMenuItem>
                    </div>
                    {canSplitHere && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                          onSelect={() => onSplit?.(t.id, "row")}
                        >
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">Split to the right</span>
                        </ContextMenuItem>
                        <ContextMenuItem
                          className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                          onSelect={() => onSplit?.(t.id, "col")}
                        >
                          <HugeiconsIcon
                            icon={ArrowDown01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">Split to the bottom</span>
                        </ContextMenuItem>
                      </>
                    )}
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                          onSelect={() => onClose(t.id)}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">Close</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );

              return (
                <Fragment key={t.id}>
                  {showGap(i) && <DropIndicator />}
                  {tabNode}
                  {panes && panes.length > 1 && (
                    <div className="flex flex-col gap-0.5 py-0.5 pl-5">
                      {panes.map((pid) => {
                        const m = paneTabs?.find((x) => x.id === pid) ?? t;
                        const segFocused = pid === (t.groupFocus ?? t.id);
                        return (
                          <div
                            key={pid}
                            data-no-drag
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(t.id);
                              onFocusPane?.(t.id, pid);
                            }}
                            className={cn(
                              "flex items-start gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                              segFocused
                                ? "bg-foreground/10 text-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground/80",
                            )}
                          >
                            <TabIcon tab={m} />
                            <span className="min-w-0 flex-1 whitespace-normal break-words text-left">
                              {labelFor(m)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {i === tabs.length - 1 && showGap(tabs.length) && (
                    <DropIndicator />
                  )}
                </Fragment>
              );
            })}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}

// Trailing shortcut hint for a plus-menu row. Renders nothing when the action
// has no binding, so an unbound action can't advertise a key that belongs to
// something else.
function ItemKeys({ keys }: { keys: string }) {
  if (!keys) return null;
  return (
    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
      {keys}
    </span>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden
      className="mx-1.5 my-0.5 h-0.5 shrink-0 rounded-full bg-primary"
    />
  );
}

// Left-edge status bar. Sits above the active pill (z-[2]) so it stays visible
// on the active tab. Renders nothing when the tab has no color.
function AccentBar({ color }: { color: TabColor | undefined }) {
  const bg = tabColorVar(color);
  if (!bg) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-1.5 left-0.5 z-[2] w-0.5 rounded-full"
      style={{ background: bg }}
    />
  );
}

export function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url = fileIconUrl(tab.title);
    return url ? (
      <img src={url} alt="" className="mt-0.5 size-3.5 shrink-0" />
    ) : null;
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  if (tab.kind === "terminal" && tab.private) {
    return (
      <HugeiconsIcon
        icon={IncognitoIcon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  if (tab.kind === "dashboard-client") {
    return (
      <HugeiconsIcon
        icon={KanbanIcon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  if (tab.kind === "device-mirror") {
    return (
      <HugeiconsIcon
        icon={SmartPhone01Icon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="mt-0.5 shrink-0"
    />
  );
}

function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Guards against a trailing blur re-resolving an edit that Enter/Escape
  // already finished (Escape must never commit).
  const done = useRef(false);

  useEffect(() => {
    // Focus on the next frame so it runs after the context menu restores focus
    // to its trigger when closing; a synchronous focus would be stolen.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  // explicit = the user pressed Enter, which pins even the unchanged label. A
  // plain blur with no change must not freeze the cwd-derived default into a
  // custom title.
  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename tab"
      className={cn(
        "w-full min-w-0 rounded-sm bg-background px-1 text-xs text-foreground",
        "outline-none ring-1 ring-border focus:ring-ring",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        // Switching windows/apps blurs the input; keep the edit open instead
        // of resolving it on the way out.
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
