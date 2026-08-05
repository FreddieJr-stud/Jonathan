import { createMiniPanelStore } from "@/modules/miniPanel/store/createMiniPanelStore";

export const useMessengerStore = createMiniPanelStore("preview-messenger");

/** Home page of the mini Messenger panel. */
export const MESSENGER_URL = "https://www.messenger.com";
