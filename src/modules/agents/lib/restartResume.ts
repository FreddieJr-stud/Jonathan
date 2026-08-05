import { respawnSession, writeToSession } from "@/modules/terminal";
import { toast } from "sonner";
import { useAgentStore } from "../store/agentStore";

/**
 * Restart the Claude Code process in a pane and resume its conversation.
 *
 * Why this exists: Claude Code renders in the terminal's *normal* buffer and
 * hard-wraps its own output to the current width. Lines committed to scrollback
 * while the pane was narrow can never be reflowed wide again (the wide version
 * was never stored). Relaunching is the only way to get a clean, full-width
 * transcript — `respawnSession` kills the PTY and clears the buffer, then
 * `claude --resume` reprints the resumed conversation at the current width.
 */
const SKIP = "--dangerously-skip-permissions";

export async function restartResumeAgent(
  leafId: number | null,
  cwd?: string | null,
): Promise<void> {
  if (leafId === null) return;
  const sess = useAgentStore.getState().sessions[leafId];
  if (!sess?.agent.toLowerCase().includes("claude")) {
    toast("Restart & resume: no Claude session in the focused pane");
    return;
  }
  toast("Restarting Claude and resuming the conversation…");
  // Fresh shell at the pane's current width; clears the mangled scrollback.
  await respawnSession(leafId, cwd ?? undefined);
  // No tracked session UUID for plain panes, so bare `--resume` opens Claude's
  // interactive session picker rather than silently grabbing the latest one.
  writeToSession(leafId, `claude --resume ${SKIP}\r`);
}
