import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatDroppedPaths,
  pasteIntoLeaf,
  useTerminalDropStore,
} from "@/modules/terminal";

type Options = {
  rootPath: string;
  isDir: (path: string) => boolean | undefined;
  onMove: (from: string, toDir: string) => void;
  /** Resolves what a pointerdown on `path` should actually drag — the full
   * multi-selection if `path` is part of one, otherwise just `path`. */
  getDragPaths: (path: string) => string[];
};

const THRESHOLD = 5;
const COMPOSER_HIGHLIGHT_CLASSES = ["ring-2", "ring-inset", "ring-primary/60"];

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

// Valid explorer-internal drop target: not any of the dragged items, not
// nested inside any of them. For a single dragged item we also reject its own
// parent (a no-op move) to match the original single-drag behavior exactly.
function isValidInternalTarget(target: string, sources: string[]): boolean {
  for (const s of sources) {
    if (target === s || target.startsWith(`${s}/`)) return false;
  }
  if (sources.length === 1 && parentDir(sources[0]) === target) return false;
  return true;
}

type ExternalTarget =
  | { kind: "composer"; el: HTMLElement }
  | { kind: "terminal"; leafId: number }
  | null;

// Pointer-based, delegated on the container (no per-row handlers); sidesteps
// native HTML5 DnD which Tauri intercepts when dragDropEnabled is on. The ghost
// follows the cursor via direct DOM writes, so dragging re-renders only when the
// drop target changes, not on every move. Beyond moving files within the tree,
// a drag can also land on the AI composer (`[data-ai-composer-drop]`) or a
// terminal pane (`[data-pane-leaf]`, the same attribute the terminal module's
// own OS-file-drop hit-test uses) — those two reuse existing cross-module
// primitives instead of a second drop pipeline.
export function useExplorerDnd({
  rootPath,
  isDir,
  onMove,
  getDragPaths,
}: Options) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const dropTargetRef = useRef<string | null>(null);
  const externalTargetRef = useRef<ExternalTarget>(null);
  const armedComposerElRef = useRef<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const optsRef = useRef({ rootPath, isDir, onMove, getDragPaths });
  optsRef.current = { rootPath, isDir, onMove, getDragPaths };

  const armComposer = (el: HTMLElement | null) => {
    if (armedComposerElRef.current === el) return;
    if (armedComposerElRef.current) {
      armedComposerElRef.current.classList.remove(...COMPOSER_HIGHLIGHT_CLASSES);
    }
    armedComposerElRef.current = el;
    if (el) el.classList.add(...COMPOSER_HIGHLIGHT_CLASSES);
  };

  const placeGhost = (x: number, y: number) => {
    lastPosRef.current = { x, y };
    const g = ghostElRef.current;
    if (g) {
      g.style.left = `${x + 12}px`;
      g.style.top = `${y + 8}px`;
    }
  };

  const ghostRef = useCallback((el: HTMLDivElement | null) => {
    ghostElRef.current = el;
    if (el) placeGhost(lastPosRef.current.x, lastPosRef.current.y);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-fs-path]");
    const primary = el?.getAttribute("data-fs-path");
    if (!primary) return;
    const sources = optsRef.current.getDragPaths(primary);
    const label =
      sources.length > 1
        ? `${sources.length} items`
        : sources[0].slice(sources[0].lastIndexOf("/") + 1);
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        active = true;
        lastPosRef.current = { x: ev.clientX, y: ev.clientY };
        setDragLabel(label);
      }
      placeGhost(ev.clientX, ev.clientY);
      const { rootPath, isDir } = optsRef.current;
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const composerEl = hitEl?.closest<HTMLElement>("[data-ai-composer-drop]") ?? null;
      const terminalEl = !composerEl
        ? hitEl?.closest<HTMLElement>("[data-pane-leaf]")
        : null;

      if (composerEl) {
        externalTargetRef.current = { kind: "composer", el: composerEl };
        armComposer(composerEl);
        useTerminalDropStore.getState().setTarget(null);
        if (dropTargetRef.current !== null) {
          dropTargetRef.current = null;
          setDropTargetDir(null);
        }
        return;
      }
      if (terminalEl) {
        const leafId = Number(terminalEl.dataset.paneLeaf);
        externalTargetRef.current = Number.isFinite(leafId)
          ? { kind: "terminal", leafId }
          : null;
        armComposer(null);
        useTerminalDropStore.getState().setTarget(
          Number.isFinite(leafId) ? leafId : null,
        );
        if (dropTargetRef.current !== null) {
          dropTargetRef.current = null;
          setDropTargetDir(null);
        }
        return;
      }

      externalTargetRef.current = null;
      armComposer(null);
      useTerminalDropStore.getState().setTarget(null);

      const hit = hitEl?.closest<HTMLElement>("[data-fs-path]");
      const p = hit?.getAttribute("data-fs-path");
      const t = p ? (isDir(p) ? p : parentDir(p)) : rootPath;
      const valid = isValidInternalTarget(t, sources) ? t : null;
      if (dropTargetRef.current !== valid) {
        dropTargetRef.current = valid;
        setDropTargetDir(valid);
      }
    };
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cleanupRef.current = null;
    };
    const end = (commit: boolean) => {
      detach();
      if (active && commit) {
        const ext = externalTargetRef.current;
        if (ext?.kind === "composer") {
          const { isDir } = optsRef.current;
          const dirs: string[] = [];
          for (const p of sources) {
            if (isDir(p)) dirs.push(p);
            else
              window.dispatchEvent(
                new CustomEvent<string>("terax:ai-attach-file", { detail: p }),
              );
          }
          if (dirs.length) {
            window.dispatchEvent(
              new CustomEvent<string>("terax:ai-insert-text", {
                detail: dirs.join(" "),
              }),
            );
          }
        } else if (ext?.kind === "terminal") {
          pasteIntoLeaf(ext.leafId, formatDroppedPaths(sources));
        } else if (dropTargetRef.current) {
          for (const p of sources) optsRef.current.onMove(p, dropTargetRef.current);
        }
      }
      armComposer(null);
      useTerminalDropStore.getState().setTarget(null);
      externalTargetRef.current = null;
      if (!active) return;
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      dropTargetRef.current = null;
      setDragLabel(null);
      setDropTargetDir(null);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    cleanupRef.current = detach;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  return { ghostRef, dragLabel, dropTargetDir, onPointerDown, onClickCapture };
}
