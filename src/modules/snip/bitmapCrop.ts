import type { SnipRect } from "./SnipOverlay";

/**
 * Crops `src` at its native resolution, so a snip taken while zoomed out (or,
 * for a captured webview frame, at a lower device-pixel ratio) isn't limited
 * to the pixels that happened to be on screen. The bitmap is fetched rather
 * than reused from an on-page <img>: an asset:// or blocked-origin image
 * would taint the canvas and make toDataURL throw — fetching it ourselves
 * sidesteps that for any same-origin/data: source.
 */
export async function cropBitmapToDataUrl(
  src: string,
  sel: SnipRect,
  imgBox: DOMRect,
): Promise<{ dataUrl: string } | null> {
  const bitmap = await createImageBitmap(await (await fetch(src)).blob());
  try {
    const scaleX = bitmap.width / imgBox.width;
    const scaleY = bitmap.height / imgBox.height;
    const sx = Math.max(0, (sel.left - imgBox.left) * scaleX);
    const sy = Math.max(0, (sel.top - imgBox.top) * scaleY);
    const sw = Math.min(bitmap.width - sx, sel.width * scaleX);
    const sh = Math.min(bitmap.height - sy, sel.height * scaleY);
    if (sw < 1 || sh < 1) return null;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png") };
  } finally {
    bitmap.close();
  }
}
