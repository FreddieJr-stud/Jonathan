import { type RefObject, useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import type { MarkdownWysiwygHandle } from "@/modules/markdown";
import type { Tab } from "@/modules/tabs";
import type { EditorPaneHandle } from "./EditorPane";

type Params = {
  tabs: Tab[];
  tabsRef: RefObject<Tab[]>;
  editorRefs: RefObject<Map<number, EditorPaneHandle>>;
  markdownRefs: RefObject<Map<number, MarkdownWysiwygHandle>>;
};

/**
 * Keeps open editor tabs in sync with on-disk changes: reloads on applied AI
 * diffs, external writes, and fs-watch events, and maintains the watch set for
 * the directories of open editor files.
 *
 * Covers both `editor` (CodeMirror) and `markdown` (Milkdown WYSIWYG) tabs —
 * both wrap `useDocument` and expose the same silently-skip-when-dirty
 * `reload()` contract.
 */
export function useEditorFileSync({
  tabs,
  tabsRef,
  editorRefs,
  markdownRefs,
}: Params) {
  const reloadTab = (id: number, kind: Tab["kind"]) => {
    if (kind === "editor") editorRefs.current.get(id)?.reload();
    else if (kind === "markdown") markdownRefs.current.get(id)?.reload();
  };

  // When an AI diff is approved (write_file applied to disk), reload any
  // open editor tabs for that path so the user sees the new content. We
  // track which approvalIds we've already handled to fire the reload only
  // once per applied diff.
  const appliedDiffsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind !== "ai-diff") continue;
      if (t.status !== "approved") continue;
      if (appliedDiffsRef.current.has(t.approvalId)) continue;
      appliedDiffsRef.current.add(t.approvalId);
      for (const e of tabs) {
        if (e.kind !== "editor" && e.kind !== "markdown") continue;
        if (e.path !== t.path) continue;
        reloadTab(e.id, e.kind);
      }
    }
  }, [tabs, editorRefs, markdownRefs]);

  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source === "editor") return;
          const normalizedPath = event.payload.path.replace(/\\/g, "/");
          const currentTabs = tabsRef.current;
          for (const t of currentTabs) {
            if (t.kind !== "editor" && t.kind !== "markdown") continue;
            if (t.path.replace(/\\/g, "/") === normalizedPath) {
              reloadTab(t.id, t.kind);
            }
          }
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [tabsRef, editorRefs, markdownRefs]);

  const editorWatchRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const want = new Set<string>();
    for (const t of tabs) {
      if (t.kind === "editor" || t.kind === "markdown") want.add(parentDir(t.path));
    }
    const prev = editorWatchRef.current;
    const toAdd = [...want].filter((d) => !prev.has(d));
    const toRemove = [...prev].filter((d) => !want.has(d));
    watchAdd(toAdd);
    watchRemove(toRemove);
    editorWatchRef.current = want;
  }, [tabs]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenFsChanged((paths) => {
      const changed = new Set(paths.map((p) => p.replace(/\\/g, "/")));
      for (const t of tabsRef.current) {
        if (t.kind !== "editor" && t.kind !== "markdown") continue;
        if (changed.has(t.path.replace(/\\/g, "/"))) {
          reloadTab(t.id, t.kind);
        }
      }
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [tabsRef, editorRefs, markdownRefs]);
}
