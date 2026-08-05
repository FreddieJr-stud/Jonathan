# Claude Buddy — plan

Secondary, frameless, translucent, always-on-top (within terax) overlay running a
**real `claude` CLI via PTY**, launched at the active terminal pane's cwd by
**Ctrl+Shift+J**. Replaces the buggy in-pane Claude instances (xterm reflow in split
panes → text repetition / narrow column). Buddy has stable fixed geometry, so the
split-reflow path never runs.

## Decisions (locked)
- Window: in-renderer overlay `<div>` (clone of `AiMiniWindow` geometry pattern). Not a real OS window.
- Shortcut: Ctrl+Shift+J (toggle).
- Launch cwd: active terminal pane cwd (fallback: workspace root).
- Backend: existing `pty_open` / `pty-bridge.ts` (Jonathan portable-pty). No new backend.
- Close = **hide + persist** PTY (resume same Claude session on reopen).
- Launch = write `claude --dangerously-skip-permissions\r` into a fresh login shell.
- Scope = **per-workspace** buddy (own PTY + geometry, keyed by workspace id).

## Architecture
1. **State** — new `buddyStore.ts` (or slice in `chatStore`): `{ open: boolean, cwd: string|null }` + `openBuddy(cwd)`, `closeBuddy()`, `toggleBuddy(cwd)`.
2. **Shortcut** — add Ctrl+Shift+J branch in `App.tsx` central keydown handler. Reads focused leaf cwd, calls `toggleBuddy(cwd)`.
3. **Geometry** — reuse `useMiniWindowGeometry` pattern (own STORE_KEY `terax-ui-buddy-geom`) so drag/resize/persist works, independent of the AI mini window.
4. **Terminal mount** — reuse the real `<TerminalPane>` (self-contained: needs only a unique `leafId` + container, not the tab/paneTree system) with a stable **negative** leafId per scope. This reuses all mature `rendererPool` TUI-resize/coalescing logic that exists for Claude Code, so the split-reflow repetition bug is genuinely avoided — no hand-rolled xterm. PTY launched via `whenSessionReady` → `writeToSession`.
5. **Launch claude** — open normal login shell at cwd, then write `claude\r` once shell is ready (robust vs spawning `claude` as PTY argv — keeps shell env/PATH). If `claude` missing, PTY shows the shell error inline.
6. **Mount point** — render `<ClaudeBuddy/>` next to `AiMiniWindow` in `App.tsx` (~line 1454), gated on `buddyStore.open`.

## Behavior
- Toggle: Ctrl+Shift+J opens+focuses; again closes (PTY persists hidden, or killed — see open Q).
- Reopen: if cwd changed vs running session, offer relaunch / keep.
- Esc inside buddy: same guard as mini (ignore when typing in the terminal).
- Visual: translucent bg (`bg-card/80` + `backdrop-blur`) for the "transparent" feel; frameless; drag header; resize handles (reuse).

## Resolved sub-decisions
- A. PTY persists on close (hidden), keyed per workspace. Relaunch only if exited or cwd changed.
- B. Per-workspace: `buddyStore` maps `workspaceId -> { open, cwd, ptyId }`; geometry STORE_KEY suffixed with workspace id.
- C. Launch: `claude --dangerously-skip-permissions\r` written into fresh shell.

## Files to touch
- NEW `src/modules/ai/store/buddyStore.ts`
- NEW `src/modules/ai/components/ClaudeBuddy.tsx`
- NEW `src/modules/ai/lib/useBuddyGeometry.ts` (or param-ize `useMiniWindowGeometry`)
- EDIT `src/app/App.tsx` (shortcut branch + mount)
- REUSE `pty-bridge.ts`, `rendererPool` xterm setup, active-pane cwd source

## Risks
- Active-pane cwd source: confirm the focused-leaf cwd is readable from a store at shortcut time (OSC-tracked in `useTerminalSession`). If not exposed, add a tiny selector.
- xterm focus vs global keydown: ensure Ctrl+Shift+J still toggles while terminal focused (handler at window/capture level).
