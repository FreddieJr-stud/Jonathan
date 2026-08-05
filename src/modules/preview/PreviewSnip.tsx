import { cropBitmapToDataUrl } from "@/modules/snip/bitmapCrop";
import { openSnippetWindow } from "@/modules/snip/openSnippet";
import { SnipOverlay, type SnipRect } from "@/modules/snip/SnipOverlay";
import { useRef } from "react";

/**
 * Hosts a frozen still frame (captured via `preview_capture`) with the same
 * drag-to-select overlay images/PDFs use, so cropping a captured webview
 * frame reuses the exact selection UX and result window (`openSnippetWindow`)
 * users already know from `ImageView`/`PdfView`. Mounted only while
 * `PreviewPane` is in snip mode — see `startSnip`/`exitSnip` there.
 */
export function PreviewSnip({
  dataUrl,
  onDone,
}: {
  dataUrl: string;
  onDone: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  const commit = (sel: SnipRect) => {
    const box = imgRef.current?.getBoundingClientRect();
    if (!box) return;
    void cropBitmapToDataUrl(dataUrl, sel, box)
      .then((crop) => crop && openSnippetWindow(crop.dataUrl, sel))
      .catch((e) => console.error("preview snip failed:", e));
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noRedundantAlt: decorative frozen-frame snapshot, not meaningful content */}
      <img
        ref={imgRef}
        src={dataUrl}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover"
      />
      <SnipOverlay active onCapture={commit} onDone={onDone} />
    </>
  );
}
