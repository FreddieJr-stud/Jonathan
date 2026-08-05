import { create } from "zustand";
import type { DownloadFinished } from "../lib/downloads";

/**
 * Queue of finished downloads awaiting a decision. The prompt is modal and
 * handles one file at a time, so parallel downloads line up rather than
 * stacking dialogs on top of each other.
 */
type DownloadState = {
  queue: DownloadFinished[];
  push: (d: DownloadFinished) => void;
  /** Drop the head of the queue — the file itself is untouched. */
  resolve: () => void;
};

export const useDownloadStore = create<DownloadState>((set) => ({
  queue: [],
  push: (d) => set((s) => ({ queue: [...s.queue, d] })),
  resolve: () => set((s) => ({ queue: s.queue.slice(1) })),
}));
