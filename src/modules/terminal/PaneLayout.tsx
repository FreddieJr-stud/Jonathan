import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { setTerminalResizeDragging } from "./lib/rendererPool";
import { isLeaf, leafIds, type PaneNode } from "./lib/panes";
import { usePaneLayout } from "./lib/paneLayoutStore";

type Props = {
  /** The host tab's tab-level layout — leaf ids are tab ids. */
  group: PaneNode;
  /** Pane (tab) id with focus. */
  focusedId: number;
  /** Workspace box the slot rects are measured against. */
  containerRef: RefObject<HTMLElement | null>;
  /** Undock a pane (close button); returns it to the strip. */
  onClosePane: (tabId: number) => void;
};

/**
 * Draws the tab-level split: a resizable grid of empty, pointer-transparent
 * slots that publish their measured rects to `usePaneLayout`. The actual
 * content is rendered by each kind-stack and positioned into those rects, so it
 * never unmounts. Only the resize handles and per-pane close buttons capture
 * pointer events; clicks in a pane body fall through to the live content.
 */
export function PaneLayout({
  group,
  focusedId,
  containerRef,
  onClosePane,
}: Props) {
  const slotRefs = useRef(new Map<number, HTMLDivElement>());
  const refCbs = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const roRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number | null>(null);

  const measureAll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // getBoundingClientRect returns real screen pixels, but the rect gets
    // re-applied as a CSS left/top/width/height on SurfaceItem — an element
    // in this same ambient-zoomed subtree (CSS `zoom`, not `transform`,
    // actually resizes layout). Re-applying a screen-px number as a CSS
    // length there gets zoomed a second time, so at any zoom other than
    // 100% the content box renders smaller/offset from the (correctly
    // native-flex-sized) ring. Divide out the zoom factor to store rects in
    // the same zoomed CSS-px space SurfaceItem's ancestors already are.
    const zoom =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--app-zoom",
        ),
      ) || 1;
    // Deliberately not pre-rounding these to a pixel grid: the browser
    // rasterizes both this fractional value and the ring's native flex box
    // through the same paint-time snapping, so leaving them fractional keeps
    // content and ring snapping identically. Rounding here with our own
    // heuristic previously disagreed with the browser's own snap and
    // produced a consistent few-px offset instead of removing it.
    const c = container.getBoundingClientRect();
    const { setRect } = usePaneLayout.getState();
    for (const [id, el] of slotRefs.current) {
      const r = el.getBoundingClientRect();
      setRect(id, {
        left: (r.left - c.left) / zoom,
        top: (r.top - c.top) / zoom,
        width: r.width / zoom,
        height: r.height / zoom,
      });
    }
  }, [containerRef]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      measureAll();
    });
  }, [measureAll]);

  const getRef = useCallback(
    (id: number) => {
      let cb = refCbs.current.get(id);
      if (!cb) {
        cb = (el: HTMLDivElement | null) => {
          const map = slotRefs.current;
          const ro = roRef.current;
          const prev = map.get(id);
          if (prev && ro) ro.unobserve(prev);
          if (el) {
            map.set(id, el);
            ro?.observe(el);
            schedule();
          } else {
            map.delete(id);
          }
        };
        refCbs.current.set(id, cb);
      }
      return cb;
    },
    [schedule],
  );

  // Observe the container + every slot; re-measure (rAF-batched) on any change.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => schedule());
    roRef.current = ro;
    const container = containerRef.current;
    if (container) ro.observe(container);
    for (const el of slotRefs.current.values()) ro.observe(el);
    // Measure synchronously here (not via schedule's rAF): by the time this
    // parent layout effect runs, ResizablePanelGroup's own child layout
    // effects have already sized the panels, so a same-tick measurement is
    // already correct. Deferring to rAF let content render one frame stale
    // on first mount, showing content misaligned against the (accurate)
    // slot ring until the next frame.
    measureAll();
    return () => {
      ro.disconnect();
      roRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [containerRef, schedule, measureAll]);

  // Publish the live pane set + focus so the stacks can place their surfaces.
  useLayoutEffect(() => {
    usePaneLayout.getState().setLayout(new Set(leafIds(group)), focusedId);
    schedule();
  }, [group, focusedId, schedule]);

  // Tear the layout down when the host stops showing a split.
  useEffect(() => () => usePaneLayout.getState().clear(), []);

  // A divider drag starts on a handle pointerdown (set there) and ends on the
  // next pointerup/cancel anywhere. While dragging, the renderer pool keeps
  // xterm fitted but withholds the PTY resize, pushing it once on release — so
  // Claude Code never commits scrollback frames at intermediate widths.
  useEffect(() => {
    const end = () => setTerminalResizeDragging(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setTerminalResizeDragging(false);
    };
  }, []);

  const renderNode = (node: PaneNode): ReactNode => {
    if (isLeaf(node)) {
      const focused = node.id === focusedId;
      return (
        <div
          ref={getRef(node.id)}
          data-pane-slot={node.id}
          className="group pointer-events-none relative h-full w-full"
        >
          <div
            className={cn(
              "absolute inset-0 rounded-md ring-1 ring-inset transition-colors",
              focused ? "ring-primary/70" : "ring-border/40",
            )}
          />
          <button
            type="button"
            title="Close pane"
            aria-label="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              onClosePane(node.id);
            }}
            className="pointer-events-auto absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </button>
        </div>
      );
    }
    return (
      <ResizablePanelGroup
        className="pointer-events-none h-full w-full"
        orientation={node.dir === "row" ? "horizontal" : "vertical"}
      >
        {node.children.map((child, i) => (
          <Fragment key={leafIds(child)[0]}>
            {i > 0 && (
              <ResizableHandle
                className="pointer-events-auto"
                onPointerDown={() => setTerminalResizeDragging(true)}
              />
            )}
            <ResizablePanel id={`pane-grp-${child.id}`} minSize="10%">
              {renderNode(child)}
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    );
  };

  return (
    <div className="pointer-events-none h-full w-full">{renderNode(group)}</div>
  );
}
