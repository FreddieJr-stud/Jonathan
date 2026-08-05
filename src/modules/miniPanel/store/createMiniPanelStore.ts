import { previewRaise } from "@/modules/preview/lib/previewWebview";
import { create, type StoreApi, type UseBoundStore } from "zustand";

/**
 * Mini panel state, shared by every `preview-*` mini webview panel (Music,
 * Messenger, Gmail, ...). The panel is a host-HTML shell; the page itself is
 * a native child webview created lazily on first open.
 *
 * `loaded` tracks whether that webview exists. Closing the panel only HIDES
 * it, so e.g. music playback or a chat session continues in the background —
 * `loaded` stays true until the user explicitly unloads.
 *
 * Deliberately not persisted: a fresh app start begins with no panel and no
 * webview, so we never pay ~100MB of WebView2 for a session nobody opened.
 */
export type MiniPanelState = {
  /** The panel's native child webview label. Set once at creation. */
  label: string;
  open: boolean;
  loaded: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setLoaded: (loaded: boolean) => void;
  /**
   * User-dragged size override, `null` until the resize grip is used (then
   * `MiniPanelWebview` falls back to its `defaultWidth`/`defaultHeight`
   * props). Lives here rather than component state so it survives close/
   * reopen — the component unmounts whenever `open` is false, but this store
   * persists for the app's lifetime.
   */
  size: { width: number; height: number } | null;
  setSize: (size: { width: number; height: number }) => void;
};

type MiniPanelStore = UseBoundStore<StoreApi<MiniPanelState>>;

/**
 * Every mini panel is anchored at the same screen slot (fixed top-right), and
 * a native child webview ignores host CSS z-index entirely — its stacking is
 * decided at the OS level, so two open at once fight for the same rect and
 * both render broken. Tracking every created store here lets `setOpen(true)`
 * hide (never unload — see `MiniPanelState` doc) every other one first, so at
 * most one is ever visible.
 */
const registry = new Set<MiniPanelStore>();

function hideOthers(self: MiniPanelStore) {
  for (const other of registry) {
    if (other !== self && other.getState().open) other.setState({ open: false });
  }
}

/**
 * Re-asserts the currently open mini panel (if any) above the Preview
 * webview's Win32 z-order. Preview tabs and mini panels are sibling native
 * child HWNDs sharing the same top-right screen rect (see `hideOthers`
 * above); `PreviewPane` calls this after every one of its own
 * `preview_show`/creates so switching or reloading a Preview tab can't steal
 * the top spot from an open panel.
 */
export function raiseOpenPanel(): void {
  for (const store of registry) {
    const state = store.getState();
    if (state.open && state.loaded) {
      void previewRaise(state.label);
      return;
    }
  }
}

/** Creates one independent mini-panel store instance per service. */
export function createMiniPanelStore(label: string): MiniPanelStore {
  const store = create<MiniPanelState>((set, get) => ({
    label,
    open: false,
    loaded: false,
    size: null,
    setOpen: (open) => {
      if (open) hideOthers(store);
      set({ open });
    },
    toggle: () => {
      const open = !get().open;
      if (open) hideOthers(store);
      set({ open });
    },
    setLoaded: (loaded) => set({ loaded }),
    setSize: (size) => set({ size }),
  }));
  registry.add(store);
  return store;
}
