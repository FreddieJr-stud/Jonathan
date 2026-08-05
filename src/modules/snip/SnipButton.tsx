export function SnipButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`rounded-md border border-border px-2 py-1 text-xs shadow-sm backdrop-blur hover:bg-accent ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-popover/90 text-popover-foreground"
      }`}
      title="Snip a region into a floating overlay"
    >
      Snip
    </button>
  );
}
