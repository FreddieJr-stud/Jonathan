import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setTerminalFontSize,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "@/modules/settings/store";
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import {
  focusLeafInput,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";

// Wheel delta -> font-size px. Tuned so one mouse notch (~100px) nudges ~2px,
// while trackpad pinch (browsers report it as ctrl+wheel with small deltas)
// scales smoothly via the fractional accumulator.
const FONT_WHEEL_SENSITIVITY = 0.02;

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Space this leaf's tab belongs to; exported into its PTY as TERAX_SPACE_ID. */
  spaceId?: string;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

export const TerminalPane = memo(
  forwardRef<TerminalPaneHandle, Props>(function TerminalPane(
    {
      leafId,
      spaceId,
      visible,
      focused = true,
      initialCwd,
      blocks = false,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const downYRef = useRef<number | null>(null);
    // Live-zoom gesture state: a float target font size and the size we
    // started from, so the preview can be scaled smoothly before committing.
    const zoomBaseFontRef = useRef(0);
    const zoomTargetFontRef = useRef(0);
    const zoomActiveRef = useRef(false);
    const { resolvedMode, themeId, customThemes } = useTheme();

    const session = useTerminalSession({
      leafId,
      spaceId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      blocks,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, themeId, customThemes, session]);

    // Ctrl+scroll / trackpad pinch zooms the terminal. For smoothness the
    // gesture only scales the terminal on the GPU (cheap, any granularity);
    // the actual `terminalFontSize` preference — which refits xterm and
    // resizes the pty — is committed once, when the gesture settles. Capture
    // phase + non-passive so we intercept the wheel before xterm scrolls the
    // scrollback and can preventDefault the webview's native page zoom.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      let commitTimer: ReturnType<typeof setTimeout> | null = null;

      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        // Window-level (see below): a trackpad pinch's ctrl+wheel events don't
        // target the terminal element, so route by cursor geometry.
        const r = el.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          return;
        e.preventDefault();
        if (!zoomActiveRef.current) {
          zoomActiveRef.current = true;
          zoomBaseFontRef.current =
            usePreferencesStore.getState().terminalFontSize;
          zoomTargetFontRef.current = zoomBaseFontRef.current;
        }
        zoomTargetFontRef.current = Math.min(
          TERMINAL_FONT_SIZE_MAX,
          Math.max(
            TERMINAL_FONT_SIZE_MIN,
            zoomTargetFontRef.current - e.deltaY * FONT_WHEEL_SENSITIVITY,
          ),
        );
        el.style.transformOrigin = "top left";
        el.style.transform = `scale(${
          zoomTargetFontRef.current / zoomBaseFontRef.current
        })`;

        if (commitTimer) clearTimeout(commitTimer);
        commitTimer = setTimeout(() => {
          el.style.transform = "";
          zoomActiveRef.current = false;
          void setTerminalFontSize(Math.round(zoomTargetFontRef.current));
        }, 140);
      };

      window.addEventListener("wheel", onWheel, {
        passive: false,
        capture: true,
      });
      return () => {
        if (commitTimer) clearTimeout(commitTimer);
        el.style.transform = "";
        window.removeEventListener("wheel", onWheel, { capture: true });
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    const promptReady = session.blockMode === "prompt";

    if (blocks) {
      return (
        <div
          className="zoom-exempt flex h-full w-full flex-col"
          style={hideStyle}
        >
          <div className="relative min-h-0 flex-1">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
            <div
              ref={containerRef}
              className="absolute inset-0 z-0"
              onMouseDown={(e) => {
                downYRef.current = e.clientY;
              }}
              onMouseUp={(e) => {
                const moved =
                  downYRef.current != null &&
                  Math.abs(e.clientY - downYRef.current) > 4;
                downYRef.current = null;
                if (!moved) session.selectBlockAt(e.clientY);
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
            />
            <BlockWatermark
              leafId={leafId}
              subscribe={session.subscribeBlocks}
            />
            <BlockOverlay
              subscribe={session.subscribeBlocks}
              getVisible={session.visibleBlocks}
              readOutput={(id) => session.readBlockId(id)?.output ?? null}
              searchBlock={session.searchBlock}
              revealMatch={session.revealMatch}
              clearSearch={session.clearSearch}
              promptReady={promptReady}
              onRunAgain={(cmd) => submitToLeaf(leafId, cmd)}
              onRestoreFocus={() => {
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className="zoom-exempt h-full w-full"
        style={hideStyle}
      />
    );
  }),
);
