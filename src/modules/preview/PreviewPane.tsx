import { useAiWindowRect } from "@/modules/ai/lib/aiWindowRect";
import { raiseOpenPanel } from "@/modules/miniPanel/store/createMiniPanelStore";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { localPdfPath } from "./lib/localPdf";
import { usePreviewSuppress } from "./lib/previewSuppress";
import {
  clearPreviewNav,
  type PreviewBounds,
  previewBack,
  previewCapture,
  previewClose,
  previewForward,
  previewHide,
  previewLabel,
  previewNavigate,
  previewOpen,
  previewSetBounds,
  previewShow,
  usePreviewNav,
} from "./lib/previewWebview";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";
import { PreviewSnip } from "./PreviewSnip";

const PdfView = lazy(() =>
  import("@/modules/editor/PdfView").then((m) => ({ default: m.PdfView })),
);

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  tabId: number;
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

type Hole = { x: number; y: number; w: number; h: number } | null;

// Gap kept between the shrunk webview and the chat window so they don't touch.
const CHAT_GAP = 8;

/** Whether the chat window's rect overlaps the preview's anchor rect at all. */
function chatOverlaps(base: PreviewBounds, hole: Hole): boolean {
  if (!hole) return false;
  return !(
    hole.x >= base.x + base.width ||
    hole.x + hole.w <= base.x ||
    hole.y >= base.y + base.height ||
    hole.y + hole.h <= base.y
  );
}

/**
 * Subtract the chat window's rect from the preview's anchor rect, returning the
 * largest single band that doesn't overlap it — so the page stays visible beside
 * the chat (a split). The native webview is one rectangle painted above all HTML
 * (host content can't punch a hole in it), so a single band is the best we can
 * do; the L-shaped remainder is filled by a themed backdrop (no white). Returns
 * `base` when there's no overlap, or `null` when the chat covers the anchor so
 * completely that no usable band remains (caller hides the webview entirely).
 */
function subtractChatRect(
  base: PreviewBounds,
  hole: Hole,
): PreviewBounds | null {
  if (!chatOverlaps(base, hole) || !hole) return base;
  const bx2 = base.x + base.width;
  const by2 = base.y + base.height;
  const hx1 = hole.x - CHAT_GAP;
  const hy1 = hole.y - CHAT_GAP;
  const hx2 = hole.x + hole.w + CHAT_GAP;
  const hy2 = hole.y + hole.h + CHAT_GAP;
  const bands: PreviewBounds[] = [
    {
      x: base.x,
      y: base.y,
      width: Math.max(0, hx1 - base.x),
      height: base.height,
    }, // left
    {
      x: Math.min(bx2, hx2),
      y: base.y,
      width: Math.max(0, bx2 - hx2),
      height: base.height,
    }, // right
    {
      x: base.x,
      y: base.y,
      width: base.width,
      height: Math.max(0, hy1 - base.y),
    }, // top
    {
      x: base.x,
      y: Math.min(by2, hy2),
      width: base.width,
      height: Math.max(0, by2 - hy2),
    }, // bottom
  ];
  const best = bands.reduce((a, b) =>
    b.width * b.height > a.width * a.height ? b : a,
  );
  if (best.width <= 0 || best.height <= 0) return null;
  return best;
}

/**
 * Hosts a native child webview (managed in `preview.rs`) over a measured anchor
 * div, giving the Preview tab real browser behavior: it loads X-Frame-Options
 * sites, follows in-page navigation, and supports back/forward. The native
 * webview paints above all HTML, so it is shown only while this tab is the
 * active, visible preview AND nothing requests suppression (see
 * `previewSuppress.ts`). While the floating AI chat overlaps it, the webview is
 * hidden so the chat isn't painted over (see `chatCoversPreview`).
 */
export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ tabId, url, visible, onUrlChange }, ref) {
    const label = previewLabel(tabId);
    const nav = usePreviewNav(label);
    const suppressed = usePreviewSuppress((s) => s.suppressed);
    // A local PDF is rendered in-document by PDF.js; the native webview refuses
    // file: navigations by design, so it stays out of the picture entirely.
    const pdfPath = localPdfPath(url);
    const chatRect = useAiWindowRect((s) => s.rect);
    // The native webview is hidden while the chat covers it; a themed backdrop
    // then fills the pane so the chat sits on the app background, not white.
    const [covered, setCovered] = useState(false);

    const anchorRef = useRef<HTMLDivElement>(null);
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    // Whether the backend webview has been created for this tab.
    const createdRef = useRef(false);
    // The URL the webview is actually on — guards the url-effect from
    // re-navigating in response to its own navigation events.
    const currentUrlRef = useRef("");
    // Reload-escalation state: a reload is "pending" until a nav event lands.
    // If the user hits reload again while one is still pending (webview stuck
    // — e.g. WebView2 renderer crashed and dropped the navigate silently), the
    // next click escalates to a full close+recreate instead of just navigating.
    const reloadPendingRef = useRef(false);
    const lastReloadAtRef = useRef(0);
    // Latest visibility decision, reachable from `openWebview` without making it
    // depend on (and be recreated by) every visibility change. Assigned below,
    // once `applyVisibility` exists.
    const applyVisibilityRef = useRef<() => void>(() => {});
    // Set once this pane is torn down, so a create still in flight can destroy
    // whatever it produces instead of leaking it (see the unmount effect).
    const disposedRef = useRef(false);
    // The frozen frame shown in place of the live webview while snipping (a
    // data: URI, or null when not snipping). Mirrored into a ref so
    // `applyVisibility` and the resize-observer push — neither of which
    // depend on `snipFrame` — can synchronously check it without being
    // recreated on every snip start/stop.
    const [snipFrame, setSnipFrame] = useState<string | null>(null);
    const snipFrameRef = useRef<string | null>(null);
    // Mirrors `visible` so the async capture's `.then` can check the *current*
    // value instead of the one closed over when the capture started — a tab
    // switch mid-capture must not arm a frozen frame for a tab that's no
    // longer showing.
    const visibleRef = useRef(visible);
    visibleRef.current = visible;

    const measure = useCallback((): PreviewBounds | null => {
      const el = anchorRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      const base = { x: r.left, y: r.top, width: r.width, height: r.height };
      // Shrink to the largest band beside the chat (null = chat fully covers).
      return subtractChatRect(base, useAiWindowRect.getState().rect);
    }, []);

    /**
     * Create the webview, flipping `createdRef` back on failure.
     *
     * `preview_open` really can reject — WebView2 refuses to build an
     * environment whose browser args disagree with one another process already
     * holds on the same user-data folder, which is what happens when two builds
     * of the app run at once. Fire-and-forgetting that rejection leaves
     * `createdRef` stuck true, so the pane believes it owns a webview that was
     * never created: every later navigate targets nothing and even the
     * close+recreate reload escalation silently no-ops. Blank pane, forever.
     */
    const openWebview = useCallback(
      (target: string, b: PreviewBounds) => {
        createdRef.current = true;
        void previewOpen(label, target, b)
          // Re-decide visibility once the webview actually exists. `add_child`
          // creates it VISIBLE, and any hide issued while the open was still in
          // flight was silently dropped — `preview_hide` no-ops when there is no
          // webview to hide yet. Nothing would re-run the visibility effect on
          // its own: `createdRef` is a ref, so flipping it causes no render, and
          // visible/suppressed/url have not changed since. Without this,
          // switching tab or space during the open leaves the native layer
          // painted over the whole app until some unrelated change perturbs the
          // effect's deps.
          .then(() => {
            // Torn down mid-create: the unmount's `preview_close` was swallowed
            // for the same reason (no webview existed yet), so `add_child` has
            // just produced an orphan — visible, painted over the whole app, and
            // with no component left to ever hide it. Close it now.
            if (disposedRef.current) {
              void previewClose(label);
              createdRef.current = false;
              return;
            }
            applyVisibilityRef.current();
          })
          .catch(() => {
            createdRef.current = false;
          });
      },
      [label],
    );

    const navigateTo = (next: string) => {
      currentUrlRef.current = next;
      // Local PDFs never touch the webview — the render swaps in PdfView and the
      // show/hide effect keeps any existing webview hidden behind it.
      if (localPdfPath(next)) {
        if (next !== url) onUrlChange(next);
        return;
      }
      if (!createdRef.current) {
        const b = measure();
        if (!b) return;
        openWebview(next, b);
      } else {
        void previewNavigate(label, next);
      }
      if (next !== url) onUrlChange(next);
    };

    // Create on first show; navigate when the tab's url changes externally
    // (port chip, AI tool, restored tab). Stays inert while a never-shown tab
    // has no url yet.
    useEffect(() => {
      if (!url) return;
      if (pdfPath) {
        currentUrlRef.current = url;
        return;
      }
      if (!visible && !createdRef.current) return;
      if (url === currentUrlRef.current) return;
      currentUrlRef.current = url;
      const b = measure();
      if (!createdRef.current) {
        if (!b) return;
        openWebview(url, b);
      } else {
        void previewNavigate(label, url);
      }
    }, [url, visible, label, measure, pdfPath, openWebview]);

    // Keep the webview glued to the anchor rect as the layout changes.
    useEffect(() => {
      const el = anchorRef.current;
      if (!el) return;
      const push = () => {
        if (!createdRef.current) return;
        // A live resize/reflow while a frozen frame is on screen must not pop
        // the webview back over it mid-drag — restoring bounds happens in
        // `exitSnip` once snipping actually ends.
        if (snipFrameRef.current) return;
        const b = measure();
        if (b) void previewSetBounds(label, b);
        else void previewHide(label);
      };
      const ro = new ResizeObserver(push);
      ro.observe(el);
      window.addEventListener("resize", push);
      window.addEventListener("scroll", push, true);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", push);
        window.removeEventListener("scroll", push, true);
      };
    }, [label, measure]);

    // Show only when active + visible + not suppressed; otherwise hide so the
    // native layer never paints over tabs, modals, or another window.
    //
    // A callback rather than a bare effect body so `openWebview` can re-apply it
    // after the async create resolves (see the comment there).
    const applyVisibility = useCallback(() => {
      if (!createdRef.current) return;
      // While a frozen frame is on screen, the live webview stays hidden no
      // matter what visible/suppressed/chat say — `exitSnip` is the only path
      // that's allowed to bring it back, so a chat-rect change or suppression
      // toggle mid-snip can't pop it up underneath the SnipOverlay drag.
      if (snipFrameRef.current) {
        void previewHide(label);
        return;
      }
      // Track whether the chat overlaps so the render can show a themed backdrop
      // (no white) under the floating chat.
      const el = anchorRef.current;
      let cov = false;
      if (visible && !suppressed && url && !pdfPath && el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          cov = chatOverlaps(
            { x: r.left, y: r.top, width: r.width, height: r.height },
            chatRect,
          );
        }
      }
      setCovered(cov);
      if (visible && !suppressed && url && !pdfPath) {
        const b = measure();
        // `null` = the chat covers the anchor; hide rather than paint over it.
        if (b) {
          void previewSetBounds(label, b);
          // Re-assert any open mini panel (Music/Messenger/Gmail) above this
          // webview afterward — they share the same screen rect as sibling
          // native child HWNDs, and Win32 stacks a just-shown/created webview
          // on top of its siblings by default, so showing Preview here can
          // otherwise silently steal the top spot from an open panel.
          void previewShow(label).then(() => raiseOpenPanel());
        } else {
          void previewHide(label);
        }
      } else {
        void previewHide(label);
      }
    }, [visible, suppressed, url, label, measure, chatRect, pdfPath]);

    applyVisibilityRef.current = applyVisibility;
    useEffect(() => {
      applyVisibility();
    }, [applyVisibility]);

    // Reload: navigate to the current URL at the browser-process level (not
    // `location.reload()` JS eval — that message silently drops if the
    // WebView2 renderer process has crashed/hung, which is the usual cause of
    // the preview going blank white with no error). `navigate()` is handled by
    // the browser process, which respawns a dead renderer automatically. If a
    // prior reload never resolved (no nav event landed) and the user reloads
    // again within a few seconds, escalate to a full close+recreate — the one
    // case a same-URL navigate can't fix (whole webview wedged, not just the
    // page).
    const handleReload = useCallback(() => {
      if (pdfPath || !createdRef.current) return;
      const target = currentUrlRef.current || url;
      if (!target) return;
      const now = Date.now();
      const stuck =
        reloadPendingRef.current && now - lastReloadAtRef.current < 4000;
      if (stuck) {
        reloadPendingRef.current = false;
        void previewClose(label).then(() => {
          createdRef.current = false;
          const b = measure();
          if (!b) return;
          openWebview(target, b);
        });
        return;
      }
      reloadPendingRef.current = true;
      lastReloadAtRef.current = now;
      void previewNavigate(label, target);
    }, [label, measure, pdfPath, url, openWebview]);

    // Snip: capture the live webview's current frame, then swap it for a
    // frozen still (`PreviewSnip`) carrying the same drag-to-select UX
    // images/PDFs already have. Capture happens BEFORE hiding — WebView2 may
    // suspend/blank a hidden controller's compositor, so hiding first risks
    // capturing nothing.
    const startSnip = useCallback(() => {
      if (!createdRef.current || !visible || suppressed || pdfPath || !url) {
        return;
      }
      void previewCapture(label)
        .then((dataUrl) => {
          if (disposedRef.current || !visibleRef.current) return;
          setSnipFrame(dataUrl);
          snipFrameRef.current = dataUrl;
          void previewHide(label);
        })
        .catch((e) => console.error("preview capture failed:", e));
    }, [label, visible, suppressed, pdfPath, url]);

    const exitSnip = useCallback(() => {
      setSnipFrame(null);
      snipFrameRef.current = null;
      // Re-decide show/hide now that the frozen-frame guard in
      // `applyVisibility` no longer applies.
      applyVisibilityRef.current();
    }, []);

    // Tab switched away mid-snip: don't leave a stale frozen frame armed for
    // when the tab is revisited (the webview itself is already hidden by the
    // `visible` branch of `applyVisibility`, independent of snip state).
    useEffect(() => {
      if (visible) return;
      setSnipFrame(null);
      snipFrameRef.current = null;
    }, [visible]);

    // Destroy the webview when the tab unmounts (closed / disposed).
    useEffect(() => {
      disposedRef.current = false;
      return () => {
        // Flagged before the close so a create still in flight can clean up
        // after itself — this `preview_close` no-ops when the webview does not
        // exist yet, exactly as `preview_hide` does.
        disposedRef.current = true;
        if (createdRef.current) void previewClose(label);
        clearPreviewNav(label);
        createdRef.current = false;
      };
    }, [label]);

    // Persist in-page navigation back to the tab so the address bar follows it
    // and the page is restored on reopen. Deliberately keyed on `nav.url` only:
    // adding `url`/`onUrlChange` would re-fire mid-navigation (when `url` has
    // been set to the new target but `nav.url` still holds the old page) and
    // revert the address bar.
    // biome-ignore lint/correctness/useExhaustiveDependencies: react to nav.url only — see comment
    useEffect(() => {
      if (!nav.url) return;
      reloadPendingRef.current = false;
      currentUrlRef.current = nav.url;
      if (nav.url !== url) onUrlChange(nav.url);
    }, [nav.url]);

    useImperativeHandle(
      ref,
      () => ({
        reload: handleReload,
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => currentUrlRef.current || url,
      }),
      [handleReload, url],
    );

    const liveUrl = nav.url || url;

    const goHome = () => {
      if (!liveUrl) {
        addressRef.current?.focus();
        return;
      }
      try {
        navigateTo(new URL(liveUrl).origin);
      } catch {
        /* malformed url — ignore */
      }
    };

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={liveUrl}
          onSubmit={navigateTo}
          onReload={handleReload}
          onBack={() => void previewBack(label)}
          onForward={() => void previewForward(label)}
          onHome={goHome}
          canGoBack={nav.canGoBack}
          canGoForward={nav.canGoForward}
          onSnip={startSnip}
          snipDisabled={!liveUrl || !!pdfPath || !!snipFrame}
        />
        {/* Anchor: the native webview is positioned over this rect. */}
        <div
          ref={anchorRef}
          className={
            url && !pdfPath
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1"
          }
        >
          {/* While the chat covers the (now-hidden) webview, fill the pane with
              the app background so the chat sits on it cleanly — no white. */}
          {covered ? <div className="absolute inset-0 bg-background" /> : null}
          {snipFrame ? (
            <PreviewSnip dataUrl={snipFrame} onDone={exitSnip} />
          ) : null}
          {pdfPath ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Loading PDF…
                </div>
              }
            >
              <PdfView
                url={convertFileSrc(pdfPath)}
                title={pdfPath.split(/[\\/]/).pop()}
                path={pdfPath}
              />
            </Suspense>
          ) : null}
          {url ? null : <EmptyState />}
        </div>
      </div>
    );
  },
);

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type a URL above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
            Ports
          </span>{" "}
          dropdown to jump straight to your running dev server.
        </p>
      </div>
    </div>
  );
}
