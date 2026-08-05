/**
 * Recognizes `file://` URLs pointing at a local PDF so the Preview tab can
 * render them with PDF.js instead of the native child webview.
 *
 * The native webview deliberately refuses every non-http(s) navigation (see
 * `on_navigation` in `preview.rs`) so a previewed remote page can never jump to
 * `file:` and read local files. That gate is what makes a pasted
 * `file:///C:/…/x.pdf` land on a blank page. Rather than weaken it, a local PDF
 * is routed to the same `PdfView` the editor uses — no security change, and the
 * text layer lands in this document so app-wide copy-on-select keeps working.
 */
export function localPdfPath(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  // `pathname` is percent-encoded and, on Windows, carries a leading slash
  // before the drive letter (`/C:/Users/…`) that no OS API accepts.
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1);
  if (!path) return null;
  // Match on the path only — a query or fragment must not defeat the check.
  if (!/\.pdf$/i.test(path)) return null;
  return path;
}
