import { openSnippetWindow } from "@/modules/snip/openSnippet";
import { cropPdfToDataUrl } from "@/modules/snip/pdfCrop";
import { SnipButton } from "@/modules/snip/SnipButton";
import { SnipOverlay, type SnipRect } from "@/modules/snip/SnipOverlay";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  TextLayer,
} from "pdfjs-dist";
// Vite resolves this to an emitted asset URL; the worker is loaded from it.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef, useState } from "react";
import "./pdf-text-layer.css";

GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Base URLs for the assets pdf.js fetches lazily at runtime, staged into
 * `public/pdfjs/` by `scripts/copy-pdfjs-assets.mjs`. Each MUST keep its
 * trailing slash — pdf.js concatenates a filename onto it and throws
 * ("must include trailing slash") otherwise.
 *
 * `wasmUrl` is load-bearing, not a nicety: pdf.js v6 decodes JPEG 2000 (JPX)
 * and JBIG2 images in WebAssembly, and it resolves BOTH the wasm and its
 * pure-JS fallback against this URL. Leave it unset and the two lookups become
 * the literal strings "nullopenjpeg.wasm" and "nullopenjpeg_nowasm_fallback.js";
 * both 404, the decoder never initializes, and every JPX image fails with
 * "JpxError: OpenJPEG failed to initialize" while the page's text renders
 * normally — i.e. a PDF that looks fine except its figures are blank. Academic
 * papers hit this constantly; a plain DCT/Flate PDF never does.
 *
 * The rest close sibling gaps: `iccUrl` (CMYK ICC profile) and `wasmUrl`/qcms
 * give accurate ICC color rather than pdf.js's Alternate/DeviceRGB fallback,
 * and the cMap / standard-font URLs cover CJK and non-embedded fonts.
 */
const PDFJS = {
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
} as const;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.0015; // per wheel delta unit

/**
 * Renders a local PDF with PDF.js as a column of page canvases, each with a
 * selectable text layer overlaid. We use PDF.js (not the native <iframe>
 * viewer) specifically so the text lives in *this* document's DOM: the
 * app-wide copy-on-select (`useCopyOnSelect`) then mirrors any highlight into
 * the clipboard, matching every other surface.
 *
 * Bytes are fetched once via the asset URL and handed to PDF.js as `data`, so
 * the worker never has to fetch the custom `asset://` protocol itself.
 *
 * Ctrl+scroll zooms: the page is re-rendered at `fitScale * zoom` so both the
 * canvas and the text layer stay crisp and pixel-aligned (a CSS transform
 * would blur the canvas and break selection registration). Re-render is
 * debounced and guarded by a token so rapid wheel ticks don't pile up.
 */
export function PdfView({
  url,
  title,
  path,
}: {
  url: string;
  title?: string;
  path?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const fitScaleRef = useRef(1); // width-fit scale at zoom = 1
  const zoomRef = useRef(1);
  const renderedZoomRef = useRef(1); // zoom the pages were last rasterized at
  const renderTokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomPct, setZoomPct] = useState(100);
  const [snipMode, setSnipMode] = useState(false);

  const commitSnip = useCallback((sel: SnipRect) => {
    const pdf = pdfRef.current;
    const pages = pagesRef.current;
    if (!pdf || !pages) return;
    const pageEls = Array.from(
      pages.querySelectorAll<HTMLElement>(".pdf-page"),
    );
    void cropPdfToDataUrl(pdf, pageEls, sel)
      .then((dataUrl) => {
        if (dataUrl) return openSnippetWindow(dataUrl, sel);
      })
      .catch((e) => console.error("pdf snip failed:", e));
  }, []);

  // Render every page at fitScale * zoom. A fresh token invalidates any
  // in-flight render so a newer zoom level always wins.
  const render = useRef(async () => {
    const container = containerRef.current;
    const pdf = pdfRef.current;
    if (!container || !pdf) return;

    const token = ++renderTokenRef.current;
    const scale = fitScaleRef.current * zoomRef.current;
    const outputScale = window.devicePixelRatio || 1;

    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      if (token !== renderTokenRef.current) return;
      const viewport = page.getViewport({ scale });

      const pageDiv = document.createElement("div");
      pageDiv.className = "pdf-page";
      // TextLayer (v6) sizes/positions spans from this CSS variable.
      pageDiv.style.setProperty("--total-scale-factor", String(scale));
      pageDiv.style.width = `${viewport.width}px`;
      pageDiv.style.height = `${viewport.height}px`;

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      pageDiv.appendChild(canvas);

      // Make the context ourselves, with alpha. Handing pdf.js the bare canvas
      // instead lets it build one with `alpha: false`, and a figure carrying an
      // SMask (soft mask) then composites against an opaque backdrop and paints
      // as a solid black rectangle over the page. pdf.js still fills the page
      // white in beginDrawing, so an alpha-enabled canvas costs us nothing.
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("2d canvas context unavailable");

      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      pageDiv.appendChild(textDiv);
      frag.appendChild(pageDiv);

      await page.render({
        // Both: `canvas` is required by the API (it tracks in-flight renders per
        // canvas), while `canvasContext` is what pdf.js actually draws through —
        // it only falls back to `canvas.getContext("2d", { alpha: false })` when
        // no context is supplied. Passing ours keeps alpha enabled.
        canvas,
        canvasContext: ctx,
        viewport,
        transform:
          outputScale !== 1
            ? [outputScale, 0, 0, outputScale, 0, 0]
            : undefined,
      }).promise;
      if (token !== renderTokenRef.current) return;

      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      await textLayer.render();
      page.cleanup();
    }
    if (token !== renderTokenRef.current) return;

    // Swap in the freshly rasterized pages and drop the live preview scale:
    // the new pages are already at the target size.
    let pages = pagesRef.current;
    if (!pages) {
      pages = document.createElement("div");
      pages.className = "pdf-pages";
      pagesRef.current = pages;
      container.replaceChildren(pages);
    }
    pages.style.transform = "";
    pages.replaceChildren(frag);
    renderedZoomRef.current = zoomRef.current;
  });

  // Load once per url, compute the width-fit baseline, then render.
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const buf = await (await fetch(url)).arrayBuffer();
        if (cancelled) return;
        task = getDocument({
          data: new Uint8Array(buf),
          cMapPacked: true,
          ...PDFJS,
        });
        const pdf = await task.promise;
        if (cancelled) return;
        pdfRef.current = pdf;

        const first = await pdf.getPage(1);
        const unscaled = first.getViewport({ scale: 1 });
        const avail = (container.clientWidth || 800) - 24; // minus padding
        fitScaleRef.current = Math.max(0.1, avail / unscaled.width);
        zoomRef.current = 1;
        setZoomPct(100);

        await render.current();
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTokenRef.current++; // abort any in-flight render
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void task?.destroy();
      pdfRef.current = null;
      pagesRef.current = null;
    };
  }, [url]);

  // Ctrl+scroll → zoom. Non-passive so we can preventDefault the webview's
  // native page zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Listen at the window (capture): a trackpad pinch emits ctrl+wheel events
    // whose target is *not* inside this container, so a container-scoped
    // listener would miss them. We route by cursor geometry instead.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const r = container.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        return;
      e.preventDefault();
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, zoomRef.current * (1 - e.deltaY * ZOOM_SENSITIVITY)),
      );
      if (next === zoomRef.current) return;
      zoomRef.current = next;
      setZoomPct(Math.round(next * 100));
      // Instant, smooth feedback: scale the already-rendered pages on the GPU
      // relative to the zoom they were rasterized at. The real (crisp)
      // re-render happens once the gesture settles.
      if (pagesRef.current) {
        const ratio = next / renderedZoomRef.current;
        pagesRef.current.style.transform = `scale(${ratio})`;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void render.current(), 140);
    };

    window.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    return () =>
      window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return (
    <div className="relative h-full w-full bg-neutral-200/40 dark:bg-neutral-900/40">
      <div
        ref={containerRef}
        className="pdf-view"
        title={title}
        data-pdf-path={path}
      />
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Loading PDF…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-destructive">
          {error}
        </div>
      )}
      <SnipOverlay
        active={snipMode}
        onCapture={commitSnip}
        onDone={() => setSnipMode(false)}
      />
      {!loading && !error && (
        <div className="absolute bottom-2 right-3 z-40 flex items-center gap-1.5">
          <SnipButton
            active={snipMode}
            onToggle={() => setSnipMode((s) => !s)}
          />
          <div className="pointer-events-none rounded-md bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white tabular-nums">
            {zoomPct}%
          </div>
        </div>
      )}
    </div>
  );
}
