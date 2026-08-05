import { createMiniPanelStore } from "@/modules/miniPanel/store/createMiniPanelStore";

export const useGmailStore = createMiniPanelStore("preview-gmail");

/** Home page of the mini Gmail panel. */
export const GMAIL_URL = "https://mail.google.com/mail/u/0/";
