import { createMiniPanelStore } from "@/modules/miniPanel/store/createMiniPanelStore";

export const useMusicStore = createMiniPanelStore("preview-music");

/** Home page of the mini player. */
export const MUSIC_URL = "https://music.youtube.com/";
