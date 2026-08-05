import { cn } from "@/lib/utils";
import { useAgentStore } from "@/modules/agents";
import { useSpaces } from "@/modules/spaces";
import { DEFAULT_SPACE_ID } from "@/modules/tabs";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type BuddyInstance, useBuddyStore } from "../store/buddyStore";

// The Claude buddy instance switcher, living in the status bar beside the
// "Open AI agent" button. Visible whenever any instance exists — even while the
// buddy overlay is hidden — so you can watch each instance's state (the dot) and
// jump to any of them in one click.
export function BuddyTabs({ cwd }: { cwd: string | null }) {
  const spaceId = useSpaces((s) => s.activeId) ?? DEFAULT_SPACE_ID;
  const cur = useBuddyStore((s) => s.bySpace[spaceId]);
  const focusInstance = useBuddyStore((s) => s.focusInstance);
  const closeInstance = useBuddyStore((s) => s.closeInstance);
  const newInstance = useBuddyStore((s) => s.newInstance);

  const instances = cur?.instances ?? [];
  const activeId = cur?.activeId ?? null;
  const open = cur?.open ?? false;

  if (instances.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar-deep">
        {instances.map((inst) => (
          <BuddyTab
            key={inst.id}
            inst={inst}
            active={open && inst.id === activeId}
            onSelect={() => focusInstance(inst.id)}
            onClose={() => closeInstance(inst.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => newInstance(cwd)}
        title="New Claude instance (at active terminal's folder)"
        aria-label="New Claude instance"
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

// amber=working (Claude is processing your prompt), red=waiting (Claude is
// asking you something interactively), green=done (turn finished), gray=idle/
// just-launched, dim=exited. Driven by the OSC-fed AgentStatus: UserPromptSubmit
// →working, Notification→waiting, Stop→done. No `idle` fires after `done`, so a
// finished turn stays green until the next prompt.
function StateDot({ inst }: { inst: BuddyInstance }) {
  const status = useAgentStore((s) => s.sessions[inst.leafId]?.status);
  const color =
    status === "waiting"
      ? "bg-red-500"
      : status === "working"
        ? "bg-amber-500"
        : status === "done"
          ? "bg-emerald-500"
          : inst.exited
            ? "bg-zinc-500"
            : "bg-muted-foreground/40";
  return <span className={cn("size-1.5 shrink-0 rounded-full", color)} />;
}

function BuddyTab({
  inst,
  active,
  onSelect,
  onClose,
}: {
  inst: BuddyInstance;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex h-5.5 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <StateDot inst={inst} />
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 max-w-28 truncate"
        title={inst.cwd ?? inst.title}
      >
        {inst.title}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close instance"
        aria-label="Close instance"
        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
