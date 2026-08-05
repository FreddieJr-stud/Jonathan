import { Cancel01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { dismissDetection, usePortDetections } from "./lib/portDetect";

type Props = {
  /** Open the detected URL in a Preview tab. */
  onOpen: (url: string) => void;
};

/**
 * Floating stack of chips for dev-server URLs detected in terminal output.
 * Sits bottom-right over the workspace surface. Click a chip to preview the
 * server; the × dismisses it. Non-intrusive — never steals focus or navigates
 * on its own.
 */
export function PortChips({ onOpen }: Props) {
  const detections = usePortDetections();
  if (detections.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1.5">
      {detections.map((d) => (
        <div
          key={d.url}
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card/95 py-1 pl-2 pr-1 text-[11px] shadow-md backdrop-blur supports-[backdrop-filter]:bg-card/80 terax-panel-in"
        >
          <button
            type="button"
            onClick={() => {
              onOpen(d.url);
              dismissDetection(d.url);
            }}
            title={`Open ${d.url} in Preview`}
            className="flex items-center gap-1.5 rounded-full text-foreground hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Globe02Icon}
              size={13}
              strokeWidth={1.75}
              className="text-emerald-500"
            />
            <span className="font-medium">Open {d.host}</span>
          </button>
          <button
            type="button"
            onClick={() => dismissDetection(d.url)}
            title="Dismiss"
            className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
