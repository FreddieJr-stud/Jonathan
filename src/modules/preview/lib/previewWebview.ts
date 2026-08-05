import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

/**
 * Thin frontend controller for the native preview webviews managed in
 * `src-tauri/src/modules/preview.rs`. Each preview tab maps to a child webview
 * labelled `preview-<tabId>`; the backend emits `terax:preview-nav` whenever the
 * page navigates so the address bar can follow it.
 */

export type PreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PreviewNav = {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

export function previewLabel(tabId: number): string {
  return `preview-${tabId}`;
}

export function previewOpen(label: string, url: string, b: PreviewBounds) {
  return invoke("preview_open", { label, url, ...b });
}
export function previewNavigate(label: string, url: string) {
  return invoke("preview_navigate", { label, url });
}
export function previewBack(label: string) {
  return invoke("preview_back", { label });
}
export function previewForward(label: string) {
  return invoke("preview_forward", { label });
}
export function previewSetBounds(label: string, b: PreviewBounds) {
  return invoke("preview_set_bounds", { label, ...b });
}
export function previewShow(label: string) {
  return invoke("preview_show", { label });
}
export function previewHide(label: string) {
  return invoke("preview_hide", { label });
}
export function previewClose(label: string) {
  return invoke("preview_close", { label });
}
/** Captures the webview's current frame as a `data:image/png;base64,...` URI
 * (Windows-only; see `preview_capture.rs`), for Preview Snip. */
export function previewCapture(label: string): Promise<string> {
  return invoke("preview_capture", { label });
}
/** Raises a webview's native child HWND to the top of its parent's Win32
 * z-order (Windows-only, no-op elsewhere; see `preview_capture.rs`). All
 * `preview-*` webviews (Preview tabs + Music/Messenger/Gmail mini panels)
 * share the same screen rect, so stacking must be asserted explicitly. */
export function previewRaise(label: string): Promise<void> {
  return invoke("preview_raise", { label });
}

// --- host-shortcut forwarding --------------------------------------------

/** One active host shortcut binding, flattened for the in-page matcher. */
export type PreviewKeyCombo = {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};

/** A key event forwarded out of a focused preview webview. */
export type PreviewKeyEvent = PreviewKeyCombo & { code: string };

/** Push the active shortcut combos to the backend, which seeds them into every
 * preview webview so host shortcuts keep firing while a preview tab is focused. */
export function previewSetKeyCombos(combos: PreviewKeyCombo[]) {
  return invoke("preview_set_key_combos", { combos: JSON.stringify(combos) });
}

/** Subscribe to host-shortcut key events forwarded from preview webviews.
 * Returns a promise resolving to the unlisten function. */
export function listenPreviewKey(handler: (e: PreviewKeyEvent) => void) {
  return listen<PreviewKeyEvent>("terax:preview-key", (e) =>
    handler(e.payload),
  );
}

// --- nav event store -----------------------------------------------------

type NavPayload = {
  label: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

const EMPTY: PreviewNav = { url: "", canGoBack: false, canGoForward: false };
const navByLabel = new Map<string, PreviewNav>();
const listeners = new Set<() => void>();
let started = false;

function ensureListener(): void {
  if (started) return;
  started = true;
  void listen<NavPayload>("terax:preview-nav", (e) => {
    const { label, url, canGoBack, canGoForward } = e.payload;
    navByLabel.set(label, { url, canGoBack, canGoForward });
    for (const l of listeners) l();
  });
}

// --- popup (window.open) forwarding --------------------------------------

type PopupPayload = { url: string };

/**
 * Subscribe to popups requested by previewed pages via `window.open()` (e.g.
 * Gmail "compose in new window"). The backend Denies the native popup — which
 * would otherwise be blocked — and forwards the URL here so it can open as a new
 * Preview tab. Returns a promise resolving to the unlisten function.
 */
export function listenPreviewPopup(handler: (url: string) => void) {
  return listen<PopupPayload>("terax:preview-popup", (e) =>
    handler(e.payload.url),
  );
}

/** Drop cached nav state once a preview tab's webview is gone. */
export function clearPreviewNav(label: string): void {
  if (navByLabel.delete(label)) for (const l of listeners) l();
}

/** Subscribe to the live address-bar state for a preview tab. */
export function usePreviewNav(label: string): PreviewNav {
  ensureListener();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => navByLabel.get(label) ?? EMPTY,
    () => EMPTY,
  );
}
