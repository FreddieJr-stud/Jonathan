import { MiniPanelWebview } from "@/modules/miniPanel/MiniPanelWebview";
import { MESSENGER_URL, useMessengerStore } from "./store/messengerStore";

/**
 * Label of the mini panel's native child webview.
 *
 * The `preview-` prefix is load-bearing, not cosmetic: `capabilities/
 * preview-key-forward.json` scopes host-shortcut forwarding to `preview-*`, and
 * `preview_set_key_combos` (preview.rs) only seeds webviews whose label starts
 * with it. Renaming this to `messenger` would silently kill Ctrl+Tab & friends
 * while the panel holds focus.
 */
const MESSENGER_LABEL = "preview-messenger";

/** Mini Messenger panel — real messenger.com in a native child webview. */
export function MessengerPanel() {
  return (
    <MiniPanelWebview
      label={MESSENGER_LABEL}
      url={MESSENGER_URL}
      title="Messenger"
      width={420}
      height={640}
      store={useMessengerStore}
    />
  );
}
