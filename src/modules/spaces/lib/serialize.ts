import {
  isLeaf,
  leafIds,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import type {
  DashboardClientTab,
  DeviceMirrorTab,
  EditorTab,
  MarkdownTab,
  PreviewTab,
  Tab,
  TabColor,
  TerminalTab,
} from "@/modules/tabs/lib/useTabs";

export type SerializedNode =
  | { kind: "leaf"; cwd?: string; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: SerializedNode[] };

// Tab-level split layout. Leaves reference a member by its index in the
// serialized tab list (live tab ids aren't stable across restarts).
export type SerializedGroupNode =
  | { kind: "leaf"; index: number }
  | { kind: "split"; dir: SplitDir; children: SerializedGroupNode[] };

type SerializedGroup = { tree: SerializedGroupNode; focus?: number };

export type SerializedTab = {
  group?: SerializedGroup;
  // Display-only overrides shared by every persisted kind.
  customTitle?: string;
  color?: TabColor;
} & (
  | {
      kind: "terminal";
      tree: SerializedNode;
      blocks?: boolean;
    }
  | { kind: "editor"; path: string }
  | { kind: "preview"; url: string }
  | { kind: "markdown"; path: string }
  | { kind: "device-mirror" }
  | { kind: "dashboard-client" }
);

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

function serializeNode(node: PaneNode, activeLeafId: number): SerializedNode {
  if (isLeaf(node)) {
    return {
      kind: "leaf",
      ...(node.cwd !== undefined && { cwd: node.cwd }),
      ...(node.id === activeLeafId && { active: true }),
    };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((c) => serializeNode(c, activeLeafId)),
  };
}

export function isSerializableTab(tab: Tab): boolean {
  switch (tab.kind) {
    case "terminal":
      return !tab.private;
    case "editor":
    case "preview":
    case "markdown":
    case "device-mirror":
    case "dashboard-client":
      return true;
    default:
      return false;
  }
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (!isSerializableTab(tab)) return null;
  // Display-only overrides persisted for every kind.
  const shared = {
    ...(tab.customTitle !== undefined && { customTitle: tab.customTitle }),
    ...(tab.color !== undefined && { color: tab.color }),
  };
  switch (tab.kind) {
    case "terminal":
      return {
        kind: "terminal",
        tree: serializeNode(tab.paneTree, tab.activeLeafId),
        ...(tab.blocks && { blocks: true }),
        ...shared,
      };
    case "editor":
      return { kind: "editor", path: tab.path, ...shared };
    case "preview":
      return { kind: "preview", url: tab.url, ...shared };
    case "markdown":
      return { kind: "markdown", path: tab.path, ...shared };
    case "device-mirror":
      return { kind: "device-mirror", ...shared };
    case "dashboard-client":
      return { kind: "dashboard-client", ...shared };
    default:
      return null;
  }
}

// Maps a host's live `group` PaneNode (leaf ids = tab ids) onto index-based
// leaves. Returns null if any member isn't in the serializable set.
function serializeGroupNode(
  node: PaneNode,
  indexById: Map<number, number>,
): SerializedGroupNode | null {
  if (isLeaf(node)) {
    const index = indexById.get(node.id);
    return index === undefined ? null : { kind: "leaf", index };
  }
  const children: SerializedGroupNode[] = [];
  for (const c of node.children) {
    const r = serializeGroupNode(c, indexById);
    if (!r) return null;
    children.push(r);
  }
  return { kind: "split", dir: node.dir, children };
}

export function serializeTabs(tabs: Tab[]): SerializedTab[] {
  // First pass: serializable tabs in order (their position becomes the index
  // members reference).
  const entries: { tab: Tab; s: SerializedTab }[] = [];
  for (const tab of tabs) {
    const s = serializeTab(tab);
    if (s) entries.push({ tab, s });
  }
  const indexById = new Map<number, number>();
  entries.forEach((e, i) => indexById.set(e.tab.id, i));
  // Second pass: attach split layouts, resolving tab ids -> indices.
  for (const e of entries) {
    if (!e.tab.group) continue;
    const tree = serializeGroupNode(e.tab.group, indexById);
    if (!tree) continue; // a member was dropped — fall back to plain tabs
    const focus =
      e.tab.groupFocus !== undefined
        ? indexById.get(e.tab.groupFocus)
        : undefined;
    e.s.group = { tree, ...(focus !== undefined && { focus }) };
  }
  return entries.map((e) => e.s);
}

type HydratedTree = {
  tree: PaneNode;
  activeLeafId: number;
  firstLeafCwd?: string;
};

function hydrateNode(
  node: SerializedNode,
  allocId: () => number,
  acc: { activeLeafId: number | null },
): PaneNode {
  if (node.kind === "leaf") {
    const id = allocId();
    if (node.active && acc.activeLeafId === null) acc.activeLeafId = id;
    return {
      kind: "leaf",
      id,
      ...(node.cwd !== undefined && { cwd: node.cwd }),
    };
  }
  const children = node.children.map((c) => hydrateNode(c, allocId, acc));
  if (children.length === 0) return { kind: "leaf", id: allocId() };
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocId(), dir: node.dir, children };
}

function hydrateTree(
  tree: SerializedNode,
  allocId: () => number,
): HydratedTree {
  const acc: { activeLeafId: number | null } = { activeLeafId: null };
  const paneTree = hydrateNode(tree, allocId, acc);
  const leaves = collectLeaves(paneTree);
  const activeLeafId = acc.activeLeafId ?? leaves[0]?.id ?? allocId();
  const firstLeafCwd =
    leaves.find((l) => l.id === activeLeafId)?.cwd ?? leaves[0]?.cwd;
  return { tree: paneTree, activeLeafId, firstLeafCwd };
}

function collectLeaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(collectLeaves);
}

function hydrateTab(
  s: SerializedTab,
  spaceId: string,
  allocId: () => number,
): Tab | null {
  // Display-only overrides restored for every kind.
  const shared = {
    ...(s.customTitle !== undefined && { customTitle: s.customTitle }),
    ...(s.color !== undefined && { color: s.color }),
  };
  switch (s.kind) {
    case "terminal": {
      const { tree, activeLeafId, firstLeafCwd } = hydrateTree(s.tree, allocId);
      const title =
        s.customTitle ??
        (firstLeafCwd ? basename(firstLeafCwd) : s.blocks ? "blocks" : "shell");
      return {
        id: allocId(),
        kind: "terminal",
        spaceId,
        cold: true,
        title,
        cwd: firstLeafCwd,
        paneTree: tree,
        activeLeafId,
        ...(s.blocks && { blocks: true }),
        ...shared,
      } satisfies TerminalTab;
    }
    case "editor":
      return {
        id: allocId(),
        kind: "editor",
        spaceId,
        cold: true,
        title: basename(s.path),
        path: s.path,
        dirty: false,
        preview: false,
        ...shared,
      } satisfies EditorTab;
    case "preview":
      return {
        id: allocId(),
        kind: "preview",
        spaceId,
        cold: true,
        title: titleFromUrl(s.url),
        url: s.url,
        ...shared,
      } satisfies PreviewTab;
    case "markdown":
      return {
        id: allocId(),
        kind: "markdown",
        spaceId,
        cold: true,
        title: basename(s.path),
        path: s.path,
        ...shared,
      } satisfies MarkdownTab;
    case "device-mirror":
      return {
        id: allocId(),
        kind: "device-mirror",
        spaceId,
        cold: true,
        title: "Phone",
        ...shared,
      } satisfies DeviceMirrorTab;
    case "dashboard-client":
      return {
        id: allocId(),
        kind: "dashboard-client",
        spaceId,
        cold: true,
        title: "Dashboard",
        ...shared,
      } satisfies DashboardClientTab;
    default:
      return null;
  }
}

export function freshTerminalTab(
  spaceId: string,
  cwd: string | null,
  allocId: () => number,
): TerminalTab {
  const leafId = allocId();
  return {
    id: allocId(),
    kind: "terminal",
    spaceId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd: cwd ?? undefined,
    paneTree: { kind: "leaf", id: leafId, ...(cwd && { cwd }) },
    activeLeafId: leafId,
  };
}

// Rebuilds a host group's PaneNode from index-based leaves, mapping each index
// to its hydrated tab id. Returns null if any referenced member failed to
// hydrate (the split is then dropped, leaving plain tabs).
function resolveGroupNode(
  node: SerializedGroupNode,
  hydrated: (Tab | null)[],
  allocId: () => number,
): PaneNode | null {
  if (node.kind === "leaf") {
    const tab = hydrated[node.index];
    return tab ? { kind: "leaf", id: tab.id } : null;
  }
  const children: PaneNode[] = [];
  for (const c of node.children) {
    const r = resolveGroupNode(c, hydrated, allocId);
    if (!r) return null;
    children.push(r);
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocId(), dir: node.dir, children };
}

export function hydrateTabs(
  serialized: SerializedTab[],
  spaceId: string,
  allocId: () => number,
): Tab[] {
  if (!Array.isArray(serialized)) return [];
  const hydrated: (Tab | null)[] = serialized.map((s) => {
    try {
      return hydrateTab(s, spaceId, allocId);
    } catch {
      // Skip corrupted entries rather than failing the whole restore.
      return null;
    }
  });
  // Reattach split layouts now that every member has a live id.
  for (let i = 0; i < serialized.length; i++) {
    const s = serialized[i];
    const host = hydrated[i];
    if (!host || !s.group) continue;
    const tree = resolveGroupNode(s.group.tree, hydrated, allocId);
    if (!tree) continue;
    const ids = leafIds(tree);
    if (ids.length <= 1) continue;
    host.group = tree;
    const focusTab =
      s.group.focus !== undefined ? hydrated[s.group.focus] : null;
    host.groupFocus =
      focusTab && ids.includes(focusTab.id) ? focusTab.id : host.id;
  }
  return hydrated.filter((t): t is Tab => t !== null);
}
