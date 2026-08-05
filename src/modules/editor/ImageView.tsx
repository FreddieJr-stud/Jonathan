import { cropBitmapToDataUrl } from "@/modules/snip/bitmapCrop";
import { openSnippetWindow } from "@/modules/snip/openSnippet";
import { SnipButton } from "@/modules/snip/SnipButton";
import { SnipOverlay, type SnipRect } from "@/modules/snip/SnipOverlay";
import { useCallback, useEffect, useRef, useState } from "react";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.1;

/**
 * Zoomable image preview. Ctrl+wheel zooms anchored at the cursor,
 * drag pans, double-click toggles fit <-> actual pixels, Ctrl+0 resets.
 * Scale 1 = fit-to-container (labeled 100%).
 */
export function ImageView({ src, alt }: { src: string; alt?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  // Transitions smooth wheel zoom but must be off while dragging.
  const [animate, setAnimate] = useState(true);
  const [badgeFlash, setBadgeFlash] = useState(false);
  const [snipMode, setSnipMode] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);
  const dragStart = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);

  const flashBadge = useCallback(() => {
    setBadgeFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setBadgeFlash(false), 1200);
  }, []);

  const reset = useCallback(() => {
    setAnimate(true);
    setView({ scale: 1, tx: 0, ty: 0 });
    flashBadge();
  }, [flashBadge]);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left - rect.width / 2;
      const py = clientY - rect.top - rect.height / 2;
      setAnimate(true);
      setView((v) => {
        const scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, v.scale * factor),
        );
        const ratio = scale / v.scale;
        return {
          scale,
          tx: px - (px - v.tx) * ratio,
          ty: py - (py - v.ty) * ratio,
        };
      });
      flashBadge();
    },
    [flashBadge],
  );

  // Native listener: React's onWheel can be passive, so preventDefault
  // (needed to stop WebView2 page zoom on ctrl+wheel) may be ignored there.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = containerRef.current;
      if (!el || el.offsetParent === null) return; // pane hidden
      if (!e.ctrlKey || e.key !== "0") return;
      e.preventDefault();
      reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const commitSnip = useCallback(
    (sel: SnipRect) => {
      const img = imgRef.current;
      if (!img) return;
      const box = img.getBoundingClientRect();
      void cropBitmapToDataUrl(src, sel, box)
        .then((crop) => crop && openSnippetWindow(crop.dataUrl, sel))
        .catch((e) => console.error("snip failed:", e));
    },
    [src],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      tx: view.tx,
      ty: view.ty,
    };
    setDragging(true);
    setAnimate(false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragStart.current;
    if (!s) return;
    setView((v) => ({
      ...v,
      tx: s.tx + e.clientX - s.x,
      ty: s.ty + e.clientY - s.y,
    }));
  };
  const endDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  const onDoubleClick = () => {
    if (snipMode) return;
    if (view.scale !== 1 || view.tx !== 0 || view.ty !== 0) {
      reset();
      return;
    }
    // At fit: jump to actual pixels (1 image px = 1 screen px).
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const fittedWidth = img.getBoundingClientRect().width / view.scale;
    const target = img.naturalWidth / fittedWidth;
    setAnimate(true);
    setView({
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, target)),
      tx: 0,
      ty: 0,
    });
    flashBadge();
  };

  const pct = Math.round(view.scale * 100);
  const badgeVisible = badgeFlash || view.scale !== 1;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-background touch-none select-none"
      style={{
        cursor: snipMode ? "crosshair" : dragging ? "grabbing" : "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="flex h-full w-full items-center justify-center p-4"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "center center",
          transition: animate ? "transform 120ms ease-out" : "none",
          willChange: "transform",
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-md border border-border shadow-sm"
          style={{
            backgroundImage:
              "conic-gradient(#e5e7eb 0.25turn, #f3f4f6 0.25turn 0.5turn, #e5e7eb 0.5turn 0.75turn, #f3f4f6 0.75turn)",
            backgroundSize: "20px 20px",
          }}
        />
      </div>
      <SnipOverlay
        active={snipMode}
        onCapture={commitSnip}
        onDone={() => setSnipMode(false)}
      />

      <div className="absolute bottom-3 right-3 z-40 flex items-center gap-1.5">
        <SnipButton active={snipMode} onToggle={() => setSnipMode((s) => !s)} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="rounded-md border border-border bg-popover/90 px-2 py-1 text-xs tabular-nums text-popover-foreground shadow-sm backdrop-blur transition-opacity duration-300 hover:bg-accent"
          style={{ opacity: badgeVisible ? 1 : 0 }}
          title="Reset zoom (Ctrl+0 or double-click)"
        >
          {pct}%
        </button>
      </div>
    </div>
  );
}
