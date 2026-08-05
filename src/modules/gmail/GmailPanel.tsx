import { MiniPanelWebview } from "@/modules/miniPanel/MiniPanelWebview";
import { GMAIL_URL, useGmailStore } from "./store/gmailStore";

/**
 * Label of the mini panel's native child webview.
 *
 * The `preview-` prefix is load-bearing, not cosmetic: `capabilities/
 * preview-key-forward.json` scopes host-shortcut forwarding to `preview-*`, and
 * `preview_set_key_combos` (preview.rs) only seeds webviews whose label starts
 * with it. Renaming this to `gmail` would silently kill Ctrl+Tab & friends
 * while the panel holds focus.
 */
const GMAIL_LABEL = "preview-gmail";

/** Mini Gmail panel — real mail.google.com in a native child webview. */
export function GmailPanel() {
  return (
    <MiniPanelWebview
      label={GMAIL_LABEL}
      url={GMAIL_URL}
      title="Gmail"
      width={700}
      height={680}
      bgColor="#ffffff"
      store={useGmailStore}
    />
  );
}
