import { Button } from "@/components/ui/button";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { StoreApi, UseBoundStore } from "zustand";
import type { MiniPanelState } from "./store/createMiniPanelStore";

export type MiniPanelButtonConfig = {
  icon: IconSvgElement;
  /** Shown when closed; while open+loaded in the background, prefixed with a note. */
  title: string;
  store: UseBoundStore<StoreApi<MiniPanelState>>;
};

/**
 * Header toggle for a mini webview panel. A dot marks "webview loaded" — i.e.
 * the panel is still alive (e.g. still playing, still connected) with the
 * panel closed. Shared by every `preview-*` mini panel (Music, Messenger,
 * Gmail).
 */
export function MiniPanelButton({ icon, title, store }: MiniPanelButtonConfig) {
  const open = store((s) => s.open);
  const loaded = store((s) => s.loaded);
  const toggle = store((s) => s.toggle);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={loaded && !open ? `${title} (running in background)` : title}
      aria-pressed={open}
      className={`relative size-7 shrink-0 rounded-md ${
        open
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />
      {loaded && !open ? (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
      ) : null}
    </Button>
  );
}
