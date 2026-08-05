import { useEffect, useState } from "react";

// `path` carries a filesystem path for pdf/markdown, or the page URL for
// preview (used only as a citation hint — the model has no fetch tool).
export type AskSource = { path: string; kind: "pdf" | "markdown" | "preview" };
type AskPopup = { x: number; y: number; text: string; source?: AskSource };

type Params = {
  captureSelectionFromElement: (el: HTMLElement) => string | null;
};

/**
 * Tracks text selections inside the terminal / editor and surfaces the
 * "Ask Jonathan" popup at the pointer. Captures the selection from the exact
 * surface element so it works in any split leaf. Dismisses on any click
 * outside the AI surface.
 */
export function useSelectionAskAi({ captureSelectionFromElement }: Params) {
  const [askPopup, setAskPopup] = useState<AskPopup | null>(null);

  useEffect(() => {
    const isInsideAi = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return !!(
        el.closest("[data-selection-ask-ai]") ||
        el.closest("[data-ai-input-bar]") ||
        el.closest("[data-ai-mini-window]")
      );
    };

    const onDown = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      setAskPopup(null);
    };
    const onUp = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      const el = e.target as HTMLElement | null;
      if (
        !el?.closest?.(".xterm, .cm-editor, .pdf-view, [data-markdown-rendered]")
      )
        return;
      // Defer one tick so xterm/CodeMirror finalize the selection.
      setTimeout(() => {
        const text = captureSelectionFromElement(el);
        if (text && text.trim().length > 0) {
          // PDF text layer and rendered markdown live in this document's DOM;
          // carry the source file path + kind so the ask can cite it and the
          // agent can read the full file (read_pdf / read_file) if needed.
          let source: AskSource | undefined;
          const pdfPath = el.closest(".pdf-view")?.getAttribute("data-pdf-path");
          const mdPath = el
            .closest("[data-markdown-rendered]")
            ?.getAttribute("data-md-path");
          if (pdfPath) source = { path: pdfPath, kind: "pdf" };
          else if (mdPath) source = { path: mdPath, kind: "markdown" };
          setAskPopup({ x: e.clientX, y: e.clientY, text, source });
        } else {
          setAskPopup(null);
        }
      }, 0);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
    };
  }, [captureSelectionFromElement]);

  return { askPopup, setAskPopup };
}
