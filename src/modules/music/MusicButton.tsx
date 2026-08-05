import { MiniPanelButton } from "@/modules/miniPanel/MiniPanelButton";
import { MusicNote01Icon } from "@hugeicons/core-free-icons";
import { useMusicStore } from "./store/musicStore";

/** Header toggle for the mini YouTube Music panel. */
export function MusicButton() {
  return (
    <MiniPanelButton
      icon={MusicNote01Icon}
      title="YouTube Music"
      store={useMusicStore}
    />
  );
}
