import { useCallback, useEffect, useRef, useState } from "react";

/** Selection geometry in viewport (client) coordinates. */
export type SnipRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const MIN_SNIP_PX = 8;

export function intersect(a: SnipRect, b: SnipRect): SnipRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Drag-to-select layer shared by the image and PDF viewers. It owns the
 * pointer interaction outright — sitting above the content means the host's
 * own gestures (image panning, PDF text selection) can't fight the drag.
 *
 * `onCapture` receives client coordinates, which is what every
 * getBoundingClientRect() the callers measure against is already in.
 */
export function SnipOverlay({
  active,
  onCapture,
  onDone,
  hint = "Drag to snip · Esc to cancel",
}: {
  active: boolean;
  onCapture: (rect: SnipRect) => void;
  onDone: () => void;
  hint?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  // Measured on pointerdown rather than during render: on the first render the
  // ref is still null, so the marquee would have nothing to position against.
  const boxRect = useRef<DOMRect | null>(null);
  const [rect, setRect] = useState<SnipRect | null>(null);

  const cancel = useCallback(() => {
    anchor.current = null;
    setRect(null);
    onDone();
  }, [onDone]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, cancel]);

  if (!active) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a free-form drag region has no matching role; Esc cancels it from the keyboard
    <div
      ref={boxRef}
      className="absolute inset-0 z-30 cursor-crosshair touch-none"
      // Every pointer event is swallowed here. The overlay is a child of the
      // viewer, so anything that bubbles reaches the host's own gestures —
      // image panning would run underneath the drag and shove the picture
      // around mid-snip.
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        boxRect.current = e.currentTarget.getBoundingClientRect();
        anchor.current = { x: e.clientX, y: e.clientY };
        setRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const a = anchor.current;
        if (!a) return;
        setRect({
          left: Math.min(a.x, e.clientX),
          top: Math.min(a.y, e.clientY),
          width: Math.abs(e.clientX - a.x),
          height: Math.abs(e.clientY - a.y),
        });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (!anchor.current) return;
        anchor.current = null;
        const sel = rect;
        setRect(null);
        onDone();
        if (sel && sel.width >= MIN_SNIP_PX && sel.height >= MIN_SNIP_PX) {
          onCapture(sel);
        }
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        cancel();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {rect && boxRect.current ? (
        <div
          className="absolute border border-dashed border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
          style={{
            left: rect.left - boxRect.current.left,
            top: rect.top - boxRect.current.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-popover/90 px-2 py-1 text-xs text-popover-foreground shadow-sm backdrop-blur">
            {hint}
          </div>
        </>
      )}
    </div>
  );
}
