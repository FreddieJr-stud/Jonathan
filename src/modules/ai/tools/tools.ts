import { buildManagedAgentTools } from "./agent";
import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";
import { buildWebTools } from "./web";

export { resolvePath, type ToolContext } from "./context";

/**
 * AI tool definitions.
 *
 * Safety policy:
 *  - All tools auto-execute without an approval prompt (`needsApproval: false`).
 *  - Safety is enforced inside each tool's `execute` instead: read-only tools
 *    (`read_file`, `list_directory`, `grep`, `glob`) and mutating tools
 *    (`write_file`, `edit`, `multi_edit`, `create_directory`, `run_command`)
 *    all run through the security guard (`security.ts`), which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.), unsafe writes, and
 *    dangerous shell commands by returning an error.
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(ctx: import("./context").ToolContext) {
  return {
    ...buildFsTools(ctx),
    ...buildWebTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
    ...buildManagedAgentTools(ctx),
  } as const;
}

export type ChatTools = ReturnType<typeof buildTools>;
