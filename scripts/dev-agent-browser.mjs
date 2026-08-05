// Runs `tauri dev` with the Preview webview's CDP debug port open, so an agent
// (Claude Code in a terax terminal tab, via Playwright MCP `--cdp-endpoint`) can
// click, scroll, read and screenshot whatever a Preview tab is showing.
//
// Why a script rather than an inline env assignment in package.json:
// `TERAX_PREVIEW_DEBUG_PORT` is read by the *Rust* process (see
// `debug_browser_args()` in src-tauri/src/modules/preview.rs), not by Vite — so
// `.env.local` cannot deliver it, it has to be a real process env var. And
// `FOO=bar tauri dev` is POSIX-only syntax that breaks under cmd.exe, which is
// what pnpm uses to run scripts on Windows.
//
// The port is deliberately opt-in. It is plain loopback CDP with no auth: any
// local process can attach and drive the previewed page. It is scoped to preview
// webviews only — they run under their own WebView2 user-data folder, hence
// their own WebView2 environment — so terax's own IPC-bearing UI webview is
// never exposed on it. Dev only; do not ship this on by default.
//
// Usage:
//   pnpm dev:agent-browser            # port 9222
//   pnpm dev:agent-browser --port=9333
//   pnpm dev:agent-browser -- --no-watch   # extra args pass through to tauri dev
import { spawn } from "node:child_process";
import net from "node:net";

const DEFAULT_PORT = 9222;

const argv = process.argv.slice(2);
const portArg = argv.find((a) => a.startsWith("--port="));
const passthrough = argv.filter((a) => a !== portArg);

const port = Number(
  portArg?.slice("--port=".length) ?? process.env.TERAX_PREVIEW_DEBUG_PORT ?? DEFAULT_PORT,
);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[agent-browser] invalid port: ${port}`);
  process.exit(1);
}

// WebView2 fixes its browser args when the environment is created — i.e. at the
// first preview webview — and silently ignores a port already in use, leaving a
// dead endpoint the MCP server would fail to attach to. Catching the clash here
// turns that into a readable message instead.
async function portIsFree(p) {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(p, "127.0.0.1");
  });
}

if (!(await portIsFree(port))) {
  console.error(
    `[agent-browser] 127.0.0.1:${port} is already in use.\n` +
      `  Another terax dev instance or a Chrome running with --remote-debugging-port=${port}?\n` +
      `  Pick another: pnpm dev:agent-browser --port=9333`,
  );
  process.exit(1);
}

console.log(
  `[agent-browser] Preview CDP endpoint: http://127.0.0.1:${port}\n` +
    `[agent-browser] Open a Preview tab, then point the agent at it:\n` +
    `    npx @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:${port}\n` +
    `[agent-browser] .mcp.json in this repo already registers that as the "preview-browser" server.\n`,
);

const child = spawn("pnpm", ["tauri", "dev", ...passthrough], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, TERAX_PREVIEW_DEBUG_PORT: String(port) },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
