import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLaunchDir } from "@/lib/launchDir";
import { quoteShellArg } from "@/lib/shellQuote";
import { useCopyOnSelect } from "@/lib/useCopyOnSelect";
import { usePresence } from "@/lib/usePresence";
import { useZoom } from "@/lib/useZoom";
import { isMarkdownPath } from "@/lib/utils";
import { AgentNotificationsBridge, restartResumeAgent } from "@/modules/agents";
import {
  AgentRunBridge,
  AiMiniWindow,
  ClaudeBuddy,
  ContentContextMenu,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useBuddyStore,
  useChatStore,
  useContentContextMenu,
  useSelectionAskAi,
} from "@/modules/ai";
import type { AskSource } from "@/modules/ai/hooks/useSelectionAskAi";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import { DashboardSyncBridge } from "@/modules/dashboard-client";
import { DownloadDialog } from "@/modules/downloads";
import {
  type EditorPaneHandle,
  NewEditorDialog,
  useEditorFileSync,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import { GmailPanel } from "@/modules/gmail";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import type { MarkdownWysiwygHandle } from "@/modules/markdown";
import { MessengerPanel } from "@/modules/messenger";
import { MusicPanel } from "@/modules/music";
import {
  listenPreviewPopup,
  type PreviewPaneHandle,
  setPreviewOpener,
  suppressPreview,
  unsuppressPreview,
  usePreviewKeyForward,
} from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type ShortcutHandlers,
  type ShortcutId,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarRail,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useSourceControlContext,
} from "@/modules/source-control";
import {
  SpaceDialog,
  SpaceSwitcher,
  useSpacePersistence,
  useSpaces,
  useSpacesBoot,
} from "@/modules/spaces";
import { StatusBar } from "@/modules/statusbar";
import {
  MAX_PANES_PER_TAB,
  TabBar,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
  visibleTabs,
} from "@/modules/tabs";
import type { TabColor } from "@/modules/tabs/lib/useTabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIds,
  navigateFocusedBlocks,
  PortChips,
  selectionForXtermElement,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseDialogs } from "./components/CloseDialogs";
import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    allocId,
    replaceTabs,
    moveTabToSpace,
    reorderTab,
    reorderTabByGap,
    newTabInSpace,
    removeTabsForSpace,
    markBooted,
    setActiveSpaceForNewTabs,
    newTab,
    newBlockTab,
    newAgentTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newDeviceMirrorTab,
    newDashboardClientTab,
    newMarkdownTab,
    setMarkdownView,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    dockTab,
    setGroupFocus,
    focusGroupDelta,
    undockMember,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // The tab that holds input focus. Equals `activeId` normally; inside a split
  // host it is the focused member pane (so input/search/split route there).
  const activeHostTab = tabs.find((x) => x.id === activeId);
  const focusedTabId = activeHostTab?.group
    ? (activeHostTab.groupFocus ?? activeId)
    : activeId;

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === focusedTabId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, focusedTabId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const markdownRefs = useRef<Map<number, MarkdownWysiwygHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  useCopyOnSelect();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    markdownRefs.current.clear();
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  } = useWorkspaceSwitcher({
    tabsRef,
    workspaceEnv,
    setWorkspaceEnv,
    resetWorkspace,
    clearWorkspaceState,
  });

  const activeSpaceId = useSpaces((s) => s.activeId);
  const activeSpaceRoot = useSpaces(
    (s) => s.spaces.find((sp) => sp.id === s.activeId)?.root ?? null,
  );
  const spacesHydrated = useSpaces((s) => s.hydrated);

  const handleWorkspaceChange = useCallback(
    async (env: WorkspaceEnv) => {
      const switched = await switchWorkspace(env);
      if (switched && activeSpaceId) {
        useSpaces.getState().setEnv(activeSpaceId, env);
      }
    },
    [switchWorkspace, activeSpaceId],
  );

  useSpacesBoot({
    ready: launchCwdResolved,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  });

  useSpacePersistence({
    tabs,
    activeId,
    activeSpaceId: activeSpaceId ?? DEFAULT_SPACE_ID,
    enabled: spacesHydrated,
  });

  const prevSpaceRef = useRef(activeSpaceId);

  // Remembers which tab was active in each space during this session, so
  // switching back to a space restores its own tab instead of always
  // landing on the strip's last tab.
  const lastActiveTabIdBySpace = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t) lastActiveTabIdBySpace.current.set(t.spaceId, t.id);
  }, [activeId, tabs]);

  useEffect(() => {
    if (!spacesHydrated || !activeSpaceId) return;
    setActiveSpaceForNewTabs(activeSpaceId);
    const prev = prevSpaceRef.current;
    prevSpaceRef.current = activeSpaceId;
    if (prev === null || prev === activeSpaceId) return;
    const meta = useSpaces
      .getState()
      .spaces.find((s) => s.id === activeSpaceId);
    if (meta) void adoptWorkspaceEnv(meta.env);
    const inSpace = visibleTabs(
      tabsRef.current.filter((t) => t.spaceId === activeSpaceId),
    );
    if (inSpace.length === 0) return;
    // Keep the active tab if it already belongs to the newly active space (a
    // cross-space jump set it explicitly).
    if (inSpace.some((t) => t.id === activeId)) return;
    // Else restore this space's own last-active tab: in-session memory first,
    // then the index persisted from disk, then fall back to the first tab.
    const remembered = lastActiveTabIdBySpace.current.get(activeSpaceId);
    if (remembered != null && inSpace.some((t) => t.id === remembered)) {
      setActiveId(remembered);
      return;
    }
    const diskIdx = useSpaces.getState().initialActiveIndex[activeSpaceId];
    const fromDisk = diskIdx != null ? inSpace[diskIdx] : undefined;
    setActiveId((fromDisk ?? inSpace[0]).id);
  }, [
    activeSpaceId,
    activeId,
    spacesHydrated,
    setActiveSpaceForNewTabs,
    setActiveId,
    adoptWorkspaceEnv,
  ]);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [spaceDialog, setSpaceDialog] = useState<
    | { mode: "create"; initialRoot: string }
    | {
        mode: "edit";
        spaceId: string;
        initialName: string;
        initialRoot: string;
      }
    | null
  >(null);

  // All tabs of the active space (incl. docked members) — used to resolve a
  // group's pane segments in the strip.
  const spaceTabsAll = useMemo(
    () => tabs.filter((t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID)),
    [tabs, activeSpaceId],
  );
  // Strip entries: hosts + standalone tabs (docked members hidden).
  const spaceTabs = useMemo(() => visibleTabs(spaceTabsAll), [spaceTabsAll]);

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    persistSidebarView,
    toggleSidebar,
    cycleSidebarView,
    handleSidebarResize,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] = useState<
    "commands" | "content"
  >("commands");
  const openCommandPalette = useCallback(
    (mode: "commands" | "content" = "commands") => {
      setPaletteInitialMode(mode);
      setCommandPaletteOpen(true);
    },
    [],
  );

  // Native preview webviews paint above all HTML, so hide them while a
  // full-surface overlay (palette, tab switcher, new-editor dialog) is open.
  const previewOverlayOpen =
    commandPaletteOpen || newEditorOpen || switcherOpen;
  useEffect(() => {
    if (previewOverlayOpen) suppressPreview("overlay");
    else unsuppressPreview("overlay");
  }, [previewOverlayOpen]);
  const miniOpen = useChatStore((s) => s.mini.open);
  const miniPresence = usePresence(miniOpen, 200);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  // The floating chat window is host HTML, which the native preview webview
  // paints over. Rather than hide the whole preview, the PreviewPane shrinks its
  // webview to sit beside the chat (it subscribes to the chat's published rect —
  // see aiWindowRect / subtractChatRect). The bottom composer (panelOpen) lives
  // in the workspace column and reflows the layout, so it never overlaps.

  const { hasComposer, keysLoaded } = useAiBootstrap();

  const activeTab = tabs.find((t) => t.id === activeId);
  // Inside a split, the focused pane drives cwd-dependent surfaces (explorer).
  const focusedTab = tabs.find((t) => t.id === focusedTabId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isBlockTab = activeTerminalTab?.blocks === true;
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ tabs, tabsRef, editorRefs, markdownRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    focusedTab,
    tabs,
    launchCwd ?? home,
    activeSpaceId,
    activeSpaceRoot,
  );

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  } = useTabCloseGuards({ tabs, disposeTab });

  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard(tabsRef);

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  // Ping-pong target: the tab active just before the current one. Tracked only
  // across same-space switches so Ctrl+Tab always lands inside the active space.
  // Cleared when that tab closes.
  const prevActiveIdRef = useRef(activeId);
  const lastActiveRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    if (activeId !== prev) {
      const pt = tabsRef.current.find((t) => t.id === prev);
      const at = tabsRef.current.find((t) => t.id === activeId);
      if (pt && at && pt.spaceId === at.spaceId) lastActiveRef.current = prev;
      prevActiveIdRef.current = activeId;
    }
  }, [activeId]);
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id));
    if (lastActiveRef.current !== null && !live.has(lastActiveRef.current)) {
      lastActiveRef.current = null;
    }
  }, [tabs]);

  // Ctrl+Tab: jump to the last-active tab in this space (ping-pong toggle).
  const switchToLastActive = useCallback(() => {
    const target = lastActiveRef.current;
    if (target == null) return;
    const space = activeSpaceId ?? DEFAULT_SPACE_ID;
    const t = tabsRef.current.find((x) => x.id === target);
    if (t && t.spaceId === space) setActiveId(target);
  }, [activeSpaceId, setActiveId]);

  // Ctrl+Shift+Tab: step one tab left in strip order within this space (wraps).
  const switchPositional = useCallback(
    (delta: 1 | -1) => {
      const space = activeSpaceId ?? DEFAULT_SPACE_ID;
      const inSpace = tabsRef.current
        .filter((t) => t.spaceId === space)
        .map((t) => t.id);
      const len = inSpace.length;
      if (len < 2) return;
      const cur = inSpace.indexOf(activeId);
      if (cur === -1) return;
      setActiveId(inSpace[(cur + delta + len) % len]);
    },
    [activeSpaceId, activeId, setActiveId],
  );

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const { spaces, activeId: sid, setActive } = useSpaces.getState();
    if (spaces.length < 2) return;
    const idx = spaces.findIndex((s) => s.id === sid);
    const next = (idx + delta + spaces.length) % spaces.length;
    setActive(spaces[next].id);
  }, []);

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  // Reads the selection from the exact surface element the user acted in, so
  // it works in any split leaf — not just the active one. Terminal selections
  // come from the matching xterm slot; editor (CodeMirror contenteditable)
  // selections come from the live DOM selection.
  const captureSelectionFromElement = useCallback(
    (el: HTMLElement): string | null => {
      const xterm = el.closest(".xterm");
      if (xterm) return selectionForXtermElement(xterm);
      // CodeMirror, the PDF text layer, and rendered markdown all keep their
      // text in this document's DOM, so the live selection is readable directly.
      if (
        el.closest(".cm-editor") ||
        el.closest(".pdf-view") ||
        el.closest("[data-markdown-rendered]")
      ) {
        const s = window.getSelection()?.toString() ?? "";
        return s.length > 0 ? s : null;
      }
      return null;
    },
    [],
  );

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  // Right-click / popup "Ask Jonathan": spawn a fresh chat session and auto-send
  // an "Expound on" prompt with the selected text. A PDF selection also cites
  // the source file path.
  const explainSelection = useCallback(
    (text?: string, source?: AskSource) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      const selection = (text ?? captureActiveSelection())?.trim();
      if (!selection) return;
      openPanel();
      // Surface the conversation log (the mini window) so the user sees the
      // streamed answer without having to open it manually.
      openMini();
      void (async () => {
        const { useChatStore } = await import("@/modules/ai/store/chatStore");
        useChatStore.getState().newSession();
        const { sendMessage } = await import("@/modules/ai/store/chatRuntime");
        // The excerpt is supplied inline so the model can answer immediately,
        // but it can also pull the rest of the source on demand: PDFs need the
        // `read_pdf` tool (read_file refuses binary); markdown is plain text so
        // `read_file` works.
        let prompt: string;
        if (source?.kind === "pdf") {
          prompt = `Expound on the following excerpt I selected from a PDF.\nSource file: ${source.path}\n\nExcerpt:\n"${selection}"\n\nThe excerpt above is usually enough. If you need more context, call read_pdf with that path to read the full document, and grep/glob the project for related material. Don't guess — gather evidence or ask.`;
        } else if (source?.kind === "markdown") {
          prompt = `Expound on the following excerpt I selected from a markdown file.\nSource file: ${source.path}\n\nExcerpt:\n"${selection}"\n\nThe excerpt above is usually enough. If you need more context, call read_file with that path to read the full document, and grep/glob the project for related material. Don't guess — gather evidence or ask.`;
        } else if (source?.kind === "preview") {
          prompt = `Expound on the following excerpt I selected from a web page open in the Preview tab.\nSource page: ${source.path}\n\nExcerpt:\n"${selection}"\n\nThe excerpt above is usually enough. If you need more context, call fetch_url with that page URL to read its full text (public content only). Don't guess — gather evidence or ask.`;
        } else {
          prompt = `Expound on "${selection}"`;
        }
        await sendMessage(prompt);
      })();
    },
    [hasComposer, captureActiveSelection, openPanel, openMini],
  );

  // Preview is a native child webview (separate process): the host can't read
  // its selection. The injected copy-on-select script (preview.rs) mirrors any
  // highlight into the clipboard, so "Ask Jonathan" for a preview tab reads the
  // clipboard and asks about it.
  const askFromPreview = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const url = activeTab?.kind === "preview" ? activeTab.url : undefined;
    void (async () => {
      try {
        const text = (await navigator.clipboard.readText())?.trim();
        if (text)
          explainSelection(
            text,
            url ? { kind: "preview", path: url } : undefined,
          );
        else focusInput(null);
      } catch {
        focusInput(null);
      }
    })();
  }, [hasComposer, explainSelection, focusInput, activeTab]);

  // "Ask Jonathan" button in the preview address bar dispatches this; routed
  // here so the address bar stays decoupled from the AI module.
  useEffect(() => {
    const onAskPreview = () => askFromPreview();
    window.addEventListener("terax:ai-ask-preview", onAskPreview);
    return () =>
      window.removeEventListener("terax:ai-ask-preview", onAskPreview);
  }, [askFromPreview]);

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (activeTab?.kind === "preview") {
      askFromPreview();
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
    askFromPreview,
  ]);

  const { askPopup, setAskPopup } = useSelectionAskAi({
    captureSelectionFromElement,
  });
  const askPresence = usePresence(Boolean(askPopup), 120);

  const { menu: contentMenu, close: closeContentMenu } = useContentContextMenu(
    captureSelectionFromElement,
  );

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    newPrivateTab(inheritedCwdForNewTab());
  }, [newPrivateTab, inheritedCwdForNewTab]);

  const openNewBlockTab = useCallback(() => {
    newBlockTab(inheritedCwdForNewTab());
  }, [newBlockTab, inheritedCwdForNewTab]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Markdown opens in its rendered view by default; a per-tab toggle flips
      // it to the raw editor. Other files default to preview (pin=false);
      // explicit actions like context-menu "Open" pass pin=true to persist.
      if (isMarkdownPath(path)) newMarkdownTab(path);
      else openFileTab(path, pin ?? false);
    },
    [openFileTab, newMarkdownTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeCwd = activeTerminalLeafCwd;

  const createSpaceFromDialog = useCallback(
    ({ name, root }: { name: string; root: string }) => {
      const { spaces, create, setActive } = useSpaces.getState();
      const base =
        name ||
        root.split(/[\\/]/).filter(Boolean).pop() ||
        `Space ${spaces.length + 1}`;
      const taken = new Set(spaces.map((s) => s.name));
      let uniqueName = base;
      for (let n = 2; taken.has(uniqueName); n++) uniqueName = `${base} ${n}`;
      const meta = create({ name: uniqueName, root, env: workspaceEnv });
      setActiveSpaceForNewTabs(meta.id);
      newTab(root);
      setActive(meta.id);
      return meta.id;
    },
    [workspaceEnv, newTab, setActiveSpaceForNewTabs],
  );

  const openNewSpaceDialog = useCallback(() => {
    setSpaceDialog({ mode: "create", initialRoot: activeCwd ?? home ?? "" });
  }, [activeCwd, home]);

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;
  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      activeTab,
      tabs,
      activeTerminalLeafCwd,
      explorerRoot,
      launchCwd,
      launchCwdResolved,
      home,
      sidebarView,
      cycleSidebarView,
      openCommitHistoryTab,
    });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  const openPreviewTab = useCallback(
    (url: string, spaceId?: string) => {
      const id = newPreviewTab(url, spaceId);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  // Let content renderers (AI markdown) and the terminal link addon open
  // clicked http(s) links in a Preview tab instead of the OS browser.
  useEffect(() => {
    setPreviewOpener((url) => openPreviewTab(url));
    return () => setPreviewOpener(null);
  }, [openPreviewTab]);

  // A previewed page's `window.open()` (e.g. Gmail compose/attachment popup) is
  // forwarded by the backend; open it as a new Preview tab rather than letting
  // WebView2 block it.
  useEffect(() => {
    const unlisten = listenPreviewPopup((url) => openPreviewTab(url));
    return () => void unlisten.then((un) => un());
  }, [openPreviewTab]);

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === focusedTabId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(focusedTabId, dir);
    },
    [focusedTabId, splitActivePane],
  );

  // Dock a tab from the strip into the active tab's split (right-click menu).
  const handleSplitTab = useCallback(
    (targetId: number, dir: "row" | "col") => {
      dockTab(activeId, targetId, dir);
    },
    [activeId, dockTab],
  );

  // Open a file from the explorer directly into the active tab's split.
  // Opens (or reuses) the file tab, then docks it beside the active host.
  const handleOpenFileInSplit = useCallback(
    (path: string, dir: "row" | "col") => {
      const host = activeId;
      const id = isMarkdownPath(path)
        ? newMarkdownTab(path)
        : openFileTab(path, true);
      if (id == null) return;
      dockTab(host, id, dir);
      // Opening the file activated its tab (the member). Re-focus the host so
      // its split layout renders immediately instead of showing the member as
      // a single pane until the strip chip is clicked. Unconditional: dockTab's
      // success flag is only set inside its deferred state updater, so we can't
      // rely on its return value here. This setActiveId enqueues after the
      // file-open's, so last-write-wins lands focus on the host either way.
      setActiveId(host);
    },
    [activeId, openFileTab, newMarkdownTab, dockTab, setActiveId],
  );

  const canSplitActive = useMemo(() => {
    const host = tabs.find((x) => x.id === activeId);
    const count = host?.group ? leafIds(host.group).length : 1;
    return count < MAX_PANES_PER_TAB;
  }, [tabs, activeId]);

  const handleCloseTabOrPane = useCallback(() => {
    // Focus inside the buddy overlay → Ctrl+W closes the active buddy instance
    // entirely (Ctrl+Shift+J only minimizes it).
    if (document.activeElement?.closest?.("[data-claude-buddy]")) {
      useBuddyStore.getState().closeActive();
      return;
    }
    const host = tabsRef.current.find((x) => x.id === activeId);
    // In a split, Ctrl+W undocks the focused pane back to the strip.
    if (host?.group) {
      undockMember(host.groupFocus ?? activeId);
      return;
    }
    if (host?.kind === "terminal" && leafIds(host.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose, undockMember]);

  const [zenMode, setZenMode] = useState(false);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => openCommandPalette("commands"),
      "commandPalette.content": () => openCommandPalette("content"),
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.deviceMirror": () => newDeviceMirrorTab(),
      "tab.dashboardClient": () => newDashboardClientTab(),
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => switchToLastActive(),
      "tab.prev": () => switchPositional(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "space.new": openNewSpaceDialog,
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "space.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () =>
        activeHostTab?.group
          ? focusGroupDelta(activeId, 1)
          : focusNextPaneInTab(focusedTabId, 1),
      "pane.focusPrev": () =>
        activeHostTab?.group
          ? focusGroupDelta(activeId, -1)
          : focusNextPaneInTab(focusedTabId, -1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": askFromSelection,
      "ai.restartResume": () => {
        // When the buddy overlay has focus, restart its active instance instead
        // of the terminal pane (keeps the buddy's skip-permissions flag).
        if (document.activeElement?.closest?.("[data-claude-buddy]")) {
          useBuddyStore.getState().restartActive();
          return;
        }
        void restartResumeAgent(activeLeafId, activeTerminalLeafCwd);
      },
      "ai.buddy": () => useBuddyStore.getState().toggle(activeTerminalLeafCwd),
      "ai.buddyCycle": () => useBuddyStore.getState().cycleInstance(),
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "sidebar.viewExplorer": () => cycleSidebarView("explorer"),
      "explorer.focus": toggleExplorerFocus,
      "tabs.panel.toggle": () => cycleSidebarView("tabs"),
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
    }),
    [
      activeId,
      openCommandPalette,
      switchToLastActive,
      switchPositional,
      cycleSpace,
      openNewSpaceDialog,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      newDeviceMirrorTab,
      openNewPrivateTab,
      openPreviewTab,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      focusGroupDelta,
      focusedTabId,
      activeHostTab,
      toggleSourceControl,
      togglePanelAndFocus,
      askFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      cycleSidebarView,
      zoomIn,
      zoomOut,
      zoomReset,
      activeLeafId,
      activeTerminalLeafCwd,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      // sidebar.toggle (Ctrl/⌘+B) always toggles, even inside a terminal — the
      // user opted to prioritise the sidebar over Claude Code's "run in
      // background" key. Ctrl+Shift+B (second binding) toggles too.
      return false;
    },
    [activeTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  // Forward host shortcuts out of focused native preview webviews so Ctrl+Tab
  // etc. work without first clicking back into the host window.
  usePreviewKeyForward();

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) {
        editorRefs.current.set(id, h);
        const line = pendingGotoLine.current.get(id);
        if (line != null) {
          pendingGotoLine.current.delete(id);
          h.gotoLine(line);
        }
      } else {
        editorRefs.current.delete(id);
      }
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerMarkdownHandle = useCallback(
    (id: number, h: MarkdownWysiwygHandle | null) => {
      if (h) markdownRefs.current.set(id, h);
      else markdownRefs.current.delete(id);
    },
    [],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      const t = tabsRef.current.find((x) => x.id === tabId);
      if (t) useSpaces.getState().setActive(t.spaceId);
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      // Last pane of the last tab: quit instead of respawning a shell.
      if (leafIds(tab.paneTree).length === 1 && all.length === 1) {
        void getCurrentWindow().close();
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const handleSetTabColor = useCallback(
    (id: number, color: TabColor | "") => updateTab(id, { color }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const handleDeleteSpace = useCallback(
    (id: string) => {
      const nextSpaceId = useSpaces.getState().remove(id);
      if (!nextSpaceId) return;
      const root = useSpaces
        .getState()
        .spaces.find((s) => s.id === nextSpaceId)?.root;
      removeTabsForSpace(id, nextSpaceId, root ?? undefined);
    },
    [removeTabsForSpace],
  );

  const handleMoveTab = useCallback(
    (tabId: number, targetSpaceId: string) => {
      if (moveTabToSpace(tabId, targetSpaceId)) {
        useSpaces.getState().setActive(targetSpaceId);
      }
    },
    [moveTabToSpace],
  );

  const handleReorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom") => {
      if (reorderTab(tabId, targetTabId, edge)) {
        const target = tabsRef.current.find((x) => x.id === targetTabId);
        if (target) useSpaces.getState().setActive(target.spaceId);
      }
    },
    [reorderTab],
  );

  const handleNewTabInSpace = useCallback(
    (spaceId: string) => {
      const root = useSpaces
        .getState()
        .spaces.find((s) => s.id === spaceId)?.root;
      newTabInSpace(spaceId, root ?? undefined);
    },
    [newTabInSpace],
  );

  const jumpToTab = useCallback(
    (tabId: number) => {
      const t = tabsRef.current.find((x) => x.id === tabId);
      if (!t) return;
      setActiveId(tabId);
      useSpaces.getState().setActive(t.spaceId);
      setSwitcherOpen(false);
    },
    [setActiveId],
  );

  const spaceSwitcher = (
    <SpaceSwitcher
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      tabs={tabs}
      onNewSpace={openNewSpaceDialog}
      onEditSpace={(id) => {
        const sp = useSpaces.getState().spaces.find((s) => s.id === id);
        if (!sp) return;
        setSpaceDialog({
          mode: "edit",
          spaceId: id,
          initialName: sp.name,
          initialRoot: sp.root ?? "",
        });
      }}
      onDeleteSpace={handleDeleteSpace}
      onNewTabInSpace={handleNewTabInSpace}
      onJumpTab={jumpToTab}
      onCloseTab={handleClose}
      onMoveTabToSpace={handleMoveTab}
      onReorderTab={handleReorderTab}
      onReorderSpaces={(ids) => useSpaces.getState().reorder(ids)}
    />
  );

  const commandPaletteItems = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandItems({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            home,
            openNewTab,
            openNewBlock: openNewBlockTab,
            openDeviceMirror: () => newDeviceMirrorTab(),
            openDashboardClient: () => newDashboardClientTab(),
            openNewPrivate: openNewPrivateTab,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => openPreviewTab(""),
            openGitGraph: openGitGraphFromContext,
            toggleSourceControl,
            closeActiveTabOrPane: handleCloseTabOrPane,
            splitPaneRight: () => splitActivePaneInActiveTab("row"),
            splitPaneDown: () => splitActivePaneInActiveTab("col"),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            showExplorer: () => cycleSidebarView("explorer"),
            toggleTabsView: () => cycleSidebarView("tabs"),
            toggleAi: togglePanelAndFocus,
            askAiSelection: askFromSelection,
            restartResumeAgent: () =>
              void restartResumeAgent(activeLeafId, activeTerminalLeafCwd),
            openSettings: () => void openSettingsWindow(),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
            spaces: useSpaces.getState().spaces,
            activeSpaceId,
            openSpacesOverview: () => setSwitcherOpen(true),
            newSpace: openNewSpaceDialog,
            switchSpace: (id) => useSpaces.getState().setActive(id),
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewBlockTab,
      newDeviceMirrorTab,
      newDashboardClientTab,
      openNewPrivateTab,
      openPreviewTab,
      openGitGraphFromContext,
      toggleSourceControl,
      handleCloseTabOrPane,
      splitActivePaneInActiveTab,
      toggleSidebar,
      cycleSidebarView,
      togglePanelAndFocus,
      askFromSelection,
      activeSpaceId,
      openNewSpaceDialog,
      activeLeafId,
      activeTerminalLeafCwd,
    ],
  );

  const pendingGotoLine = useRef<Map<number, number>>(new Map());
  const openContentHit = useCallback(
    (path: string, line: number) => {
      const id = openFileTab(path, true);
      if (id == null) return;
      const h = editorRefs.current.get(id);
      if (h) h.gotoLine(line);
      else pendingGotoLine.current.set(id, line);
    },
    [openFileTab],
  );

  const insertHistoryCommand = useMemo(
    () =>
      isTerminalTab && activeLeafId !== null
        ? (cmd: string) => {
            writeToSession(activeLeafId, cmd);
            terminalRefs.current.get(activeLeafId)?.focus();
          }
        : null,
    [isTerminalTab, activeLeafId],
  );

  useAiLiveBridge({
    setLive,
    activeId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
    terminalRefs,
  });

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={spaceTabs}
              activeId={activeId}
              onToggleSidebar={toggleSidebar}
              onOpenTabsView={() => cycleSidebarView("tabs")}
              tabsViewActive={sidebarView === "tabs"}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
              spaceSwitcher={spaceSwitcher}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={`${sidebarWidthRef.current}px`}
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={handleSidebarResize}
              >
                <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                  <div
                    key={sidebarView}
                    className="min-h-0 flex-1 terax-panel-in"
                  >
                    {sidebarView === "explorer" ? (
                      <FileExplorer
                        ref={explorerRef}
                        rootPath={explorerRoot}
                        gitStatus={
                          explorerGitDecorations ? sourceControl.status : null
                        }
                        activeFilePath={explorerActiveFilePath}
                        onOpenFile={handleOpenFile}
                        onOpenFileInSplit={handleOpenFileInSplit}
                        canSplit={canSplitActive}
                        onPathRenamed={handlePathRenamed}
                        onPathDeleted={handlePathDeleted}
                        onRevealInTerminal={cdInNewTab}
                        onAttachToAgent={handleAttachFileToAgent}
                      />
                    ) : sidebarView === "tabs" ? (
                      <TabBar
                        tabs={spaceTabs}
                        activeId={activeId}
                        onSelect={setActiveId}
                        onNew={openNewTab}
                        onOpenDashboard={() => newDashboardClientTab()}
                        onNewPrivate={openNewPrivateTab}
                        onNewPreview={() => openPreviewTab("")}
                        onNewEditor={() => setNewEditorOpen(true)}
                        onNewGitGraph={openGitGraphFromContext}
                        onClose={handleClose}
                        onPin={pinTab}
                        onRename={handleRenameTab}
                        onColor={handleSetTabColor}
                        onReorder={reorderTabByGap}
                        onSplit={handleSplitTab}
                        canSplit={canSplitActive}
                        paneTabs={spaceTabsAll}
                        onFocusPane={(hostId, memberId) =>
                          setGroupFocus(hostId, memberId)
                        }
                      />
                    ) : (
                      <SourceControlPanel
                        open
                        sourceControl={sourceControl}
                        onOpenDiff={openGitDiffTab}
                        onOpenGitGraph={openGitGraphFromContext}
                        onOpenFile={handleOpenFile}
                      />
                    )}
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="relative min-h-0 flex-1">
                    <WorkspaceSurface
                      tabs={tabs}
                      activeId={activeId}
                      activeTab={activeTab}
                      registerTerminalHandle={registerTerminalHandle}
                      onSearchReady={handleSearchReady}
                      onCwd={handleTerminalCwd}
                      onExit={handleLeafExit}
                      onFocusLeaf={handleFocusLeaf}
                      registerEditorHandle={registerEditorHandle}
                      onEditorDirtyChange={handleEditorDirty}
                      onEditorCloseTab={disposeTab}
                      registerPreviewHandle={registerPreviewHandle}
                      onPreviewUrlChange={handlePreviewUrl}
                      onAiDiffAccept={(id) => respondToApproval(id, true)}
                      onAiDiffReject={(id) => respondToApproval(id, false)}
                      onOpenCommitFile={openCommitFileDiffTab}
                      onGitHistorySearchHandle={setGitHistoryHandle}
                      onSetMarkdownView={setMarkdownView}
                      registerMarkdownHandle={registerMarkdownHandle}
                      onFocusPane={(id) => setGroupFocus(activeId, id)}
                      onClosePane={undockMember}
                    />
                    <PortChips onOpen={openPreviewTab} />
                  </div>

                  <WorkspaceInputBar
                    isBlockTab={isBlockTab}
                    isTerminalTab={isTerminalTab}
                    activeLeafId={activeLeafId}
                    cwd={activeCwd}
                    home={home}
                    hasComposer={hasComposer}
                    panelOpen={panelOpen}
                    keysLoaded={keysLoaded}
                    onConnect={() => void openSettingsWindow("models")}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={handleWorkspaceChange}
              onOpenMini={openMini}
              hasComposer={hasComposer}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
            />
          )}

          <AgentNotificationsBridge tabs={tabs} onActivate={onActivateAgent} />
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          <ClaudeBuddy />
          {hasComposer && miniPresence.mounted ? (
            <AiMiniWindow state={miniPresence.state} />
          ) : null}
          {askPresence.mounted ? (
            <SelectionAskAi
              state={askPresence.state}
              x={askPopup?.x ?? 0}
              y={askPopup?.y ?? 0}
              onAsk={() => {
                const text = askPopup?.text;
                const source = askPopup?.source;
                setAskPopup(null);
                explainSelection(text, source);
              }}
              onDismiss={() => setAskPopup(null)}
            />
          ) : null}
          {contentMenu ? (
            <ContentContextMenu
              menu={contentMenu}
              onAsk={() => explainSelection(contentMenu.text)}
              onClose={closeContentMenu}
            />
          ) : null}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={paletteInitialMode}
            commandItems={commandPaletteItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            insertCommand={insertHistoryCommand}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <SpaceDialog
            open={spaceDialog !== null}
            onOpenChange={(o) => {
              if (!o) setSpaceDialog(null);
            }}
            mode={spaceDialog?.mode ?? "create"}
            initialName={
              spaceDialog?.mode === "edit" ? spaceDialog.initialName : ""
            }
            initialRoot={spaceDialog?.initialRoot ?? ""}
            onSubmit={({ name, root }) => {
              if (spaceDialog?.mode === "edit") {
                const { setRoot, rename } = useSpaces.getState();
                setRoot(spaceDialog.spaceId, root);
                rename(
                  spaceDialog.spaceId,
                  name ||
                    root.split(/[\\/]/).filter(Boolean).pop() ||
                    spaceDialog.initialName,
                );
              } else {
                createSpaceFromDialog({ name, root });
              }
            }}
          />

          {/* Mounted at the shell root, not in the header: the panel hosts a
              native webview and must not be clipped by the header's overflow. */}
          <MusicPanel />
          <MessengerPanel />
          <GmailPanel />
          <DashboardSyncBridge />

          {/* Prompts for a file downloaded inside a preview webview. Preview
              opens the staged file in a tab; ignoring it lets the file expire. */}
          <DownloadDialog
            onPreview={(path) => openFileTab(path, true)}
            workspaceRoot={activeSpaceRoot}
          />

          <UpdaterDialog />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
            pendingAppClose={pendingAppClose}
            onCancelAppClose={cancelAppClose}
            onConfirmAppClose={confirmAppClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
