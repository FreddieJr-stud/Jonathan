import { MiniPanelWebview } from "@/modules/miniPanel/MiniPanelWebview";
import { MUSIC_URL, useMusicStore } from "./store/musicStore";

/**
 * Label of the mini player's native child webview.
 *
 * The `preview-` prefix is load-bearing, not cosmetic: `capabilities/
 * preview-key-forward.json` scopes host-shortcut forwarding to `preview-*`, and
 * `preview_set_key_combos` (preview.rs) only seeds webviews whose label starts
 * with it. Renaming this to `music` would silently kill Ctrl+Tab & friends while
 * the player holds focus.
 */
const MUSIC_LABEL = "preview-music";

/** Mini YouTube Music player — real music.youtube.com in a native child webview. */
export function MusicPanel() {
  return (
    <MiniPanelWebview
      label={MUSIC_LABEL}
      url={MUSIC_URL}
      title="YouTube Music"
      width={400}
      height={620}
      store={useMusicStore}
    />
  );
}
