import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

const MIN_OPACITY = 0.15;
const MIN_WIDTH = 40;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

const win = getCurrentWindow();

/**
 * A single floating crop. The window itself is frameless, transparent and
 * always-on-top, so this component only draws the image plus its hover chrome.
 */
export function SnippetApp() {
  const [src, setSrc] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const aspect = useRef(1);
  const toastTimer = useRef<number | undefined>(undefined);
  // Logical size the crop was spawned at; every scale is relative to it, so
  // repeated zooming never accumulates rounding drift.
  const baseSize = useRef<{ w: number; h: number } | null>(null);
  const scaleRef = useRef(1);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string | null>("take_snippet_data", { label: win.label })
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          void win.close();
          return;
        }
        setSrc(data);
      })
      .catch((e) => {
        console.error("snippet load failed:", e);
        void win.close();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rescale = useCallback(
    (factor: number) => {
      const base = baseSize.current;
      if (!base) return;
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, scaleRef.current * factor),
      );
      if (next === scaleRef.current) return;
      scaleRef.current = next;
      void win.setSize(
        new LogicalSize(
          Math.max(MIN_WIDTH, base.w * next),
          Math.max(MIN_WIDTH, base.h * next),
        ),
      );
      flash(`${Math.round(next * 100)}%`);
    },
    [flash],
  );

  // Ctrl+wheel resizes (mirrors the image viewer's zoom); plain wheel dials
  // transparency so the snippet can sit over content the user still needs.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        rescale(e.deltaY < 0 ? 1.1 : 1 / 1.1);
        return;
      }
      setOpacity((o) =>
        Math.min(1, Math.max(MIN_OPACITY, o + (e.deltaY < 0 ? 0.06 : -0.06))),
      );
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [rescale]);

  const blob = useCallback(async () => {
    if (!src) throw new Error("no image");
    return await (await fetch(src)).blob();
  }, [src]);

  const copy = useCallback(async () => {
    try {
      const b = await blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
      flash("Copied");
    } catch (e) {
      console.error("copy failed:", e);
      flash("Copy failed");
    }
  }, [blob, flash]);

  const saveAs = useCallback(async () => {
    try {
      const path = await save({
        defaultPath: "snippet.png",
        filters: [{ name: "PNG image", extensions: ["png"] }],
      });
      if (!path) return;
      const buf = await (await blob()).arrayBuffer();
      await invoke("save_snippet_png", {
        path,
        bytes: Array.from(new Uint8Array(buf)),
      });
      flash("Saved");
    } catch (e) {
      console.error("save failed:", e);
      flash("Save failed");
    }
  }, [blob, flash]);

  const onImageLoad = async (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    aspect.current = img.naturalWidth / Math.max(1, img.naturalHeight);
    try {
      const scale = await win.scaleFactor();
      const size = await win.innerSize();
      baseSize.current = { w: size.width / scale, h: size.height / scale };
    } catch (err) {
      console.error("snippet size probe failed:", err);
    }
    void win.show();
  };

  // Custom resize instead of startResizeDragging: the native drag can't hold
  // the aspect ratio, and a stretched crop is worse than useless.
  const onResizePointerDown = async (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    const scale = await win.scaleFactor();
    const pos = await win.outerPosition();
    const originX = pos.x / scale;
    const originY = pos.y / scale;

    const onMove = (ev: PointerEvent) => {
      const w = Math.max(MIN_WIDTH, ev.screenX - originX);
      const h = Math.max(MIN_WIDTH, ev.screenY - originY);
      // Follow whichever axis the pointer pushed further, keep ratio on the other.
      const width = Math.max(w, h * aspect.current);
      // Keep the ratio in sync so the +/- buttons continue from here.
      if (baseSize.current) scaleRef.current = width / baseSize.current.w;
      void win.setSize(new LogicalSize(width, width / aspect.current));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const btn: React.CSSProperties = {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    border: "none",
    borderRadius: 6,
    background: "rgba(20,20,24,0.72)",
    color: "#fff",
    font: "600 11px system-ui, sans-serif",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole window body is the drag surface; a role here would misdescribe it, and its actions are all reachable via the buttons and Esc
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        userSelect: "none",
        cursor: "grab",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(e) => {
        if (e.button === 0) void win.startDragging();
      }}
    >
      {src && (
        <img
          src={src}
          alt="snippet"
          draggable={false}
          onLoad={onImageLoad}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            opacity,
            outline: hovered ? "1px solid rgba(255,255,255,0.55)" : "none",
            outlineOffset: -1,
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          display: "flex",
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: "opacity 140ms ease-out",
          pointerEvents: hovered ? "auto" : "none",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          style={btn}
          title="Smaller (Ctrl+wheel down)"
          onClick={() => rescale(1 / 1.1)}
        >
          −
        </button>
        <button
          type="button"
          style={btn}
          title="Bigger (Ctrl+wheel up)"
          onClick={() => rescale(1.1)}
        >
          +
        </button>
        <button type="button" style={btn} title="Copy image" onClick={copy}>
          ⧉
        </button>
        <button type="button" style={btn} title="Save as PNG" onClick={saveAs}>
          ↓
        </button>
        <button
          type="button"
          style={{ ...btn, background: "rgba(180,32,42,0.85)" }}
          title="Close (Esc)"
          onClick={() => void win.close()}
        >
          ✕
        </button>
      </div>

      {(toast || opacity < 1) && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: 4,
            padding: "2px 6px",
            borderRadius: 6,
            background: "rgba(20,20,24,0.72)",
            color: "#fff",
            font: "600 10px system-ui, sans-serif",
            backdropFilter: "blur(6px)",
            pointerEvents: "none",
          }}
        >
          {toast ?? `${Math.round(opacity * 100)}%`}
        </div>
      )}

      <button
        type="button"
        aria-label="Resize snippet"
        onPointerDown={onResizePointerDown}
        title="Drag to resize"
        style={{
          position: "absolute",
          right: 2,
          bottom: 2,
          width: 18,
          height: 18,
          padding: 0,
          borderRadius: 5,
          // Dark plate + light chevron so the grip reads over any crop, light
          // or dark. The 16px hover-only triangle was effectively invisible.
          border: "1px solid rgba(255,255,255,0.65)",
          cursor: "nwse-resize",
          opacity: hovered ? 1 : 0.55,
          transition: "opacity 140ms ease-out",
          background:
            "linear-gradient(135deg, rgba(20,20,24,0.78) 55%, rgba(255,255,255,0.9) 55%)",
        }}
      />
    </div>
  );
}
