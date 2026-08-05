import { MiniPanelButton } from "@/modules/miniPanel/MiniPanelButton";
import { Mail01Icon } from "@hugeicons/core-free-icons";
import { useGmailStore } from "./store/gmailStore";

/** Header toggle for the mini Gmail panel. */
export function GmailButton() {
  return (
    <MiniPanelButton icon={Mail01Icon} title="Gmail" store={useGmailStore} />
  );
}
