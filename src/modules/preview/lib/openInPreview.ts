/**
 * Registry that lets non-React call sites (terminal link addon) and content
 * renderers (AI markdown) open an http(s) URL in a new Preview tab without
 * threading the tab API through every layer. `App` registers the opener once;
 * callers use `openInPreview`, falling back to the OS browser when it returns
 * false (no opener yet, or a non-web scheme like mailto/file).
 */
type PreviewOpener = (url: string) => void;

let opener: PreviewOpener | null = null;

export function setPreviewOpener(fn: PreviewOpener | null): void {
  opener = fn;
}

/**
 * Open an http(s) URL in a new Preview tab. Returns true if handled, false if
 * the caller should fall back (e.g. open in the OS browser).
 */
export function openInPreview(url: string): boolean {
  if (!opener) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  opener(url);
  return true;
}
