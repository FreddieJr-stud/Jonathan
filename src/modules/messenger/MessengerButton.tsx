import { MiniPanelButton } from "@/modules/miniPanel/MiniPanelButton";
import { MessageMultiple01Icon } from "@hugeicons/core-free-icons";
import { useMessengerStore } from "./store/messengerStore";

/** Header toggle for the mini Messenger panel. */
export function MessengerButton() {
  return (
    <MiniPanelButton
      icon={MessageMultiple01Icon}
      title="Messenger"
      store={useMessengerStore}
    />
  );
}
