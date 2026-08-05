import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useAiWindowRect } from "./aiWindowRect";
import {
  applyDrag,
  applyResize,
  clampGeom,
  defaultGeom,
  type Geom,
  isDegenerateViewport,
  type ResizeDir,
  type Viewport,
} from "./miniWindowGeometry";

// Same DOM-driven gesture engine as the AI mini window, parameterized by a
// storage key. When `publish` is set (buddy visible) the live rect is mirrored
// to the shared AiWindowRect store, so the Preview tab's native webview — which
// always paints above HTML — shrinks to sit beside the buddy instead of
// covering it. Cleared when hidden/unmounted so the preview reclaims its space.

const viewport = (): Viewport => ({
  vw: window.innerWidth,
  vh: window.innerHeight,
});

function loadGeom(storeKey: string): Geom | null {
  try {
    const raw = window.localStorage.getItem(storeKey);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof p.x === "number" &&
      typeof p.y === "number" &&
      typeof p.w === "number" &&
      typeof p.h === "number"
    ) {
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    }
  } catch {
    // corrupt entry — fall back to default placement
  }
  return null;
}

function saveGeom(storeKey: string, g: Geom) {
  try {
    window.localStorage.setItem(storeKey, JSON.stringify(g));
  } catch {
    // private mode / quota — geometry just won't persist
  }
}

type Compute = (start: Geom, dx: number, dy: number, vp: Viewport) => Geom;

/** Drives the buddy window's position and size entirely through the DOM (no
 * React state), so neither terminal output nor any re-render can disturb an
 * in-flight gesture. Writes are batched into a single rAF per frame. */
export function useBuddyGeometry(storeKey: string, publish: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const geom = useRef<Geom>({ x: 0, y: 0, w: 0, h: 0 });
  const frame = useRef(0);
  const pending = useRef<Geom | null>(null);
  const publishRef = useRef(publish);
  publishRef.current = publish;

  const flush = useCallback(() => {
    frame.current = 0;
    const el = ref.current;
    const g = pending.current;
    if (!el || !g) return;
    el.style.left = `${g.x}px`;
    el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`;
    el.style.height = `${g.h}px`;
    if (publishRef.current) useAiWindowRect.getState().set(g);
  }, []);

  const write = useCallback(
    (g: Geom) => {
      geom.current = g;
      pending.current = g;
      if (frame.current === 0) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useLayoutEffect(() => {
    const g = clampGeom(loadGeom(storeKey) ?? defaultGeom(viewport()), viewport());
    geom.current = g;
    const el = ref.current;
    if (el) {
      el.style.left = `${g.x}px`;
      el.style.top = `${g.y}px`;
      el.style.width = `${g.w}px`;
      el.style.height = `${g.h}px`;
    }
    // On a Windows minimize the window reports a tiny viewport (~160x28) without
    // setting document.hidden, so reclamping here would shove the buddy into the
    // top-right corner with no recovery on restore. isDegenerateViewport ignores
    // any viewport too small to hold the window. After a real restore we reclamp
    // once against the recovered viewport so the buddy stays on-screen.
    const onResize = () => {
      const vp = viewport();
      if (isDegenerateViewport(vp)) return;
      write(clampGeom(geom.current, vp));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame.current) cancelAnimationFrame(frame.current);
      // Buddy unmounted — preview reclaims its full rect.
      useAiWindowRect.getState().set(null);
    };
  }, [write, storeKey]);

  // Publish the current rect when the buddy becomes visible; clear it when
  // hidden so the preview webview doesn't keep a hole for a closed buddy.
  useEffect(() => {
    useAiWindowRect.getState().set(publish ? geom.current : null);
  }, [publish]);

  const beginGesture = useCallback(
    (e: React.PointerEvent, compute: Compute, threshold: number) => {
      const el = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = geom.current;
      let armed = threshold <= 0;
      if (armed) {
        e.preventDefault();
        el.setPointerCapture?.(pointerId);
        document.body.style.userSelect = "none";
      }

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!armed) {
          if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
          armed = true;
          el.setPointerCapture?.(pointerId);
          document.body.style.userSelect = "none";
        }
        write(compute(start, dx, dy, viewport()));
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        if (!armed) return;
        el.releasePointerCapture?.(pointerId);
        document.body.style.userSelect = "";
        saveGeom(storeKey, geom.current);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [write, storeKey],
  );

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "button, input, select, textarea, a, [role], [data-no-drag]",
        )
      )
        return;
      beginGesture(e, applyDrag, 4);
    },
    [beginGesture],
  );

  const startResize = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      beginGesture(
        e,
        (start, dx, dy, vp) => applyResize(start, dir, dx, dy, vp),
        0,
      );
    },
    [beginGesture],
  );

  return { ref, onHeaderPointerDown, startResize };
}
