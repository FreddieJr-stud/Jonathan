import type { PDFDocumentProxy } from "pdfjs-dist";
import { intersect, type SnipRect } from "./SnipOverlay";

/** Oversampling over on-screen size, so a snip taken while zoomed out is sharp. */
const SHARP = 2;
/** Guards against rasterizing a poster-sized page at 2x into an OOM. */
const MAX_PAGE_DIM = 8000;

/**
 * Crops a region out of a rendered PDF by re-rasterizing the pages it covers
 * at a higher scale, rather than copying the on-screen canvases — the latter
 * would bake in whatever zoom happened to be active.
 *
 * `pageEls` must be in document order, one per PDF page, each sized to its
 * on-screen box. A selection spanning a page break composites both pages; the
 * gap between them stays transparent.
 */
export async function cropPdfToDataUrl(
  pdf: PDFDocumentProxy,
  pageEls: HTMLElement[],
  sel: SnipRect,
): Promise<string | null> {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sel.width * SHARP));
  out.height = Math.max(1, Math.round(sel.height * SHARP));
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;

  let painted = false;

  for (const [i, el] of pageEls.entries()) {
    const box = el.getBoundingClientRect();
    const pageRect: SnipRect = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };
    const inter = intersect(sel, pageRect);
    if (!inter || box.width < 1) continue;

    const page = await pdf.getPage(i + 1);
    // Derive scale from the live box instead of the viewer's zoom refs: the box
    // already reflects any CSS transform applied mid-gesture.
    const unscaled = page.getViewport({ scale: 1 });
    const onScreenScale = box.width / unscaled.width;
    const renderScale = Math.min(
      onScreenScale * SHARP,
      MAX_PAGE_DIM / unscaled.width,
      MAX_PAGE_DIM / unscaled.height,
    );
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // CSS px on screen -> px in the freshly rendered canvas.
    const k = renderScale / onScreenScale;
    outCtx.drawImage(
      canvas,
      (inter.left - box.left) * k,
      (inter.top - box.top) * k,
      inter.width * k,
      inter.height * k,
      (inter.left - sel.left) * SHARP,
      (inter.top - sel.top) * SHARP,
      inter.width * SHARP,
      inter.height * SHARP,
    );
    painted = true;
    page.cleanup();
  }

  return painted ? out.toDataURL("image/png") : null;
}
