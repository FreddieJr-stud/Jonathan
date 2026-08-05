import { create } from "zustand";

/**
 * The live viewport rect of the floating AI mini window (CSS/logical px,
 * window-relative — same space as `getBoundingClientRect`). Published by
 * `useMiniWindowGeometry` on every move/resize and cleared on unmount.
 *
 * The Preview tab's native child webview paints above all HTML and can't be
 * partially occluded, so it subtracts this rect from its own bounds (shrinking
 * to the largest band beside the chat) instead of hiding outright. `null` means
 * the chat window isn't mounted — the preview takes its full anchor rect.
 */
export type AiWindowRect = { x: number; y: number; w: number; h: number };

type State = {
  rect: AiWindowRect | null;
  set: (rect: AiWindowRect | null) => void;
};

export const useAiWindowRect = create<State>((set) => ({
  rect: null,
  set: (rect) => set({ rect }),
}));
