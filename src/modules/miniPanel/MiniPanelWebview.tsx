import { useAiWindowRect } from "@/modules/ai/lib/aiWindowRect";
import { usePreviewSuppress } from "@/modules/preview/lib/previewSuppress";
import {
  type PreviewBounds,
  previewClose,
  previewHide,
  previewNavigate,
  previewOpen,
  previewRaise,
  previewSetBounds,
  previewShow,
} from "@/modules/preview/lib/previewWebview";
import {
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import type { MiniPanelState } from "./store/createMiniPanelStore";

type Rect = { x: number; y: number; w: number; h: number };

const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;
// Mirrors the `max-w-[calc(100vw-1.5rem)]` / `max-h-[calc(100vh-3.5rem)]`
// Tailwind clamp below, so a drag never asks for more than the panel could
// actually render at (dragging past the edge would otherwise silently stop
// having any visible effect once CSS clamps it, which reads as a stuck drag).
const VIEWPORT_MARGIN_X = 24; // 1.5rem
const VIEWPORT_MARGIN_Y = 56; // 3.5rem (space for the top-11 offset)

function overlaps(b: PreviewBounds, hole: Rect | null): boolean {
  if (!hole) return false;
  return !(
    hole.x >= b.x + b.width ||
    hole.x + hole.w <= b.x ||
    hole.y >= b.y + b.height ||
    hole.y + hole.h <= b.y
  );
}

export type MiniPanelConfig = {
  /**
   * Native child webview label. Must start with `preview-` — load-bearing,
   * not cosmetic: `capabilities/preview-key-forward.json` scopes host-
   * shortcut forwarding to `preview-*`, and `preview_set_key_combos`
   * (preview.rs) only seeds webviews whose label starts with it. Any other
   * prefix silently kills Ctrl+Tab & friends while the panel holds focus.
   */
  label: string;
  url: string;
  title: string;
  /** Starting size, used until the user drags the resize grip. */
  width: number;
  height: number;
  /** Anchor fill while the page loads, so the panel never flashes white. */
  bgColor?: string;
  store: UseBoundStore<StoreApi<MiniPanelState>>;
};

/**
 * A mini webview panel: a host-HTML shell anchored top-right, with a native
 * child webview (real site, not an `<iframe>`) painted over the shell's body
 * rect. Shared by every `preview-*` mini panel (Music, Messenger, Gmail).
 *
 * Closing the panel calls `previewHide`, never `previewClose`, so e.g. music
 * keeps playing or a chat session stays connected; only "Unload" destroys the
 * webview. The webview shares the pinned WebView2 profile every `preview-*`
 * webview uses, so a sign-in done in any Preview tab (or another mini panel)
 * carries over and survives restarts.
 *
 * Plain HTML rather than a Radix popover on purpose: popovers push a
 * `previewSuppress` reason, which would hide this very webview the moment it
 * opened. It still honors the global suppression store, so modals, the
 * command palette, and window blur hide it like any other preview surface.
 */
export function MiniPanelWebview({
  label,
  url,
  title,
  width,
  height,
  bgColor = "#030303",
  store,
}: MiniPanelConfig) {
  const open = store((s) => s.open);
  const loaded = store((s) => s.loaded);
  const setOpen = store((s) => s.setOpen);
  const setLoaded = store((s) => s.setLoaded);
  const size = store((s) => s.size);
  const setSize = store((s) => s.setSize);
  const suppressed = usePreviewSuppress((s) => s.suppressed);
  const chatRect = useAiWindowRect((s) => s.rect);

  const panelWidth = size?.width ?? width;
  const panelHeight = size?.height ?? height;

  const anchorRef = useRef<HTMLDivElement>(null);
  // Mirrors `loaded` for effects that must not re-run when it flips.
  const loadedRef = useRef(false);
  loadedRef.current = loaded;

  const measure = useCallback((): PreviewBounds | null => {
    const el = anchorRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const b = { x: r.left, y: r.top, width: r.width, height: r.height };
    // The floating chat is host HTML; the native layer would paint over it.
    // The panel is small, so shrinking beside the chat isn't worth it — hide.
    return overlaps(b, useAiWindowRect.getState().rect) ? null : b;
  }, []);

  // Create on first open, then show/hide with the panel and the global
  // suppression store. Never closes — that is what keeps background
  // playback/sessions alive. `chatRect` is read through the store inside
  // `measure`, so it must stay in the dep list to re-evaluate when the chat
  // window moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chatRect drives measure() via the store — see comment
  useEffect(() => {
    if (!open || suppressed) {
      if (loadedRef.current) void previewHide(label);
      return;
    }
    // Rect is only measurable after the panel has painted this frame.
    const id = requestAnimationFrame(() => {
      const b = measure();
      if (!b) {
        if (loadedRef.current) void previewHide(label);
        return;
      }
      if (!loadedRef.current) {
        loadedRef.current = true;
        setLoaded(true);
        // Undo the optimistic flip if creation fails (WebView2 can refuse the
        // environment when another build of the app holds the shared profile
        // folder with different browser args). Left swallowed, `loadedRef`
        // stays true and the panel shows a black rect that Reload can never
        // repair, because every later call targets a webview that never existed.
        void previewOpen(label, url, b)
          .then(() => void previewRaise(label))
          .catch(() => {
            loadedRef.current = false;
            setLoaded(false);
          });
        return;
      }
      void previewSetBounds(label, b);
      void previewShow(label).then(() => void previewRaise(label));
    });
    return () => cancelAnimationFrame(id);
  }, [open, suppressed, chatRect, measure, setLoaded, label, url]);

  // Keep the webview glued to the panel through window resizes.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const push = () => {
      if (!loadedRef.current || !store.getState().open) return;
      const b = measure();
      if (b) void previewSetBounds(label, b);
      else void previewHide(label);
    };
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener("resize", push);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", push);
    };
  }, [measure, label, store]);

  // Esc closes the panel (background state, e.g. playback, continues).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Destroy the webview when the app tears down, so no orphan survives a reload.
  useEffect(() => {
    return () => {
      if (loadedRef.current) void previewClose(label);
    };
  }, [label]);

  const unload = () => {
    void previewClose(label);
    loadedRef.current = false;
    setLoaded(false);
    setOpen(false);
  };

  // Reload-escalation state: mirrors `PreviewPane.handleReload`. WebView2 can
  // wedge (renderer crashed/hung) and then silently drop a plain navigate() —
  // the page just stays on whatever was last painted (often blank white).
  // Clicking Reload again within the window means the first one never took,
  // so escalate to a full close+recreate, which respawns the renderer.
  const lastReloadAtRef = useRef(0);
  const reload = () => {
    if (!loadedRef.current) return;
    const now = Date.now();
    const stuck = now - lastReloadAtRef.current < 4000;
    lastReloadAtRef.current = now;
    if (!stuck) {
      void previewNavigate(label, url);
      return;
    }
    void previewClose(label).then(() => {
      const b = measure();
      if (!b) {
        loadedRef.current = false;
        setLoaded(false);
        return;
      }
      void previewOpen(label, url, b)
        .then(() => {
          // Re-decide visibility now that the recreate has landed: `add_child`
          // creates the webview visible, but the panel may have been hidden
          // (Esc, another mini panel opening, suppression) while this was in
          // flight — see the identical race in PreviewPane's `openWebview`.
          if (store.getState().open && !usePreviewSuppress.getState().suppressed) {
            void previewShow(label).then(() => void previewRaise(label));
          } else {
            void previewHide(label);
          }
        })
        .catch(() => {
          loadedRef.current = false;
          setLoaded(false);
        });
    });
  };

  // Drag the bottom-left corner to resize. The panel is right-anchored, so
  // growing width means moving the LEFT edge further left (pointer delta
  // negative-x = wider); growing height moves the bottom edge down
  // (positive-y = taller). The ResizeObserver already watching `anchorRef`
  // (see the effect above) picks up the resulting layout change and pushes
  // it to the native webview — no separate `previewSetBounds` call needed
  // here.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = panelWidth;
    const startHeight = panelHeight;
    const onMove = (ev: PointerEvent) => {
      const maxWidth = window.innerWidth - VIEWPORT_MARGIN_X;
      const maxHeight = window.innerHeight - VIEWPORT_MARGIN_Y;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(MIN_WIDTH, startWidth - (ev.clientX - startX)),
      );
      const nextHeight = Math.min(
        maxHeight,
        Math.max(MIN_HEIGHT, startHeight + (ev.clientY - startY)),
      );
      setSize({ width: nextWidth, height: nextHeight });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      (ev.target as Element | null)?.releasePointerCapture?.(ev.pointerId);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!open) return null;

  return (
    <div
      className="fixed right-3 top-11 z-40 flex max-h-[calc(100vh-3.5rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-lg"
      style={{ width: panelWidth, height: panelHeight }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <span className="flex-1 truncate text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <button
          type="button"
          title="Reload (click again if it's still stuck)"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={reload}
        >
          <HugeiconsIcon
            icon={ArrowReloadHorizontalIcon}
            size={13}
            strokeWidth={1.75}
          />
        </button>
        <button
          type="button"
          title="Close this session and free memory"
          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={unload}
        >
          Unload
        </button>
        <button
          type="button"
          title="Close (keeps running in the background)"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(false)}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
        </button>
      </div>
      {/* Anchor: the native webview is positioned over this rect. Dark fill so
          the panel never flashes white before the page paints, and so the
          suppressed state (modal open) reads as a deliberate surface. */}
      <div
        ref={anchorRef}
        className="min-h-0 flex-1"
        style={{ backgroundColor: bgColor }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-drag resize grip, not a semantic control */}
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="absolute bottom-0 left-0 z-10 size-4 cursor-nesw-resize"
      >
        <div className="absolute bottom-1 left-1 size-2 rounded-tr-sm border-b-2 border-l-2 border-border" />
      </div>
    </div>
  );
}
