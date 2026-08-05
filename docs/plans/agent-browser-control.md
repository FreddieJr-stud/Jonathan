# Agent browser control in Preview tabs (Path A — CDP + external MCP)

Goal: Claude Code running in a terax terminal tab can click, screenshot, scroll,
read, and open/navigate/close **Preview tabs** — the claude-in-chrome capability
set, without claude-in-chrome.

## Why not claude-in-chrome

Preview tabs are Tauri child webviews on **WebView2** (`src-tauri/src/modules/preview.rs`,
`Window::add_child`). WebView2 hosts no Chrome extension runtime — no MV3 service
worker host, no native messaging, no toolbar/side-panel surface, and the extension
ships as a Web-Store CRX. `preview.rs:150` already states this. Not fixable.

Equivalent capability comes from CDP, which WebView2 *does* speak.

## Existing groundwork

- `preview.rs:162 debug_browser_args()` — `TERAX_PREVIEW_DEBUG_PORT` →
  `--remote-debugging-port=N` on preview webviews only.
- Preview webviews run their own WebView2 user-data folder (`preview-webview`),
  so the debug port never exposes terax's own IPC-bearing UI webview.
- `agent.rs:agent_enable_claude_hooks` — existing pattern for terax writing
  Claude Code config on the user's behalf.

---

## Phase 1 — in-page control  ✅ built

Run it:
```
pnpm dev:agent-browser              # port 9222
pnpm dev:agent-browser --port=9333  # if 9222 is taken
```

- **`scripts/dev-agent-browser.mjs`** — sets `TERAX_PREVIEW_DEBUG_PORT` and
  spawns `pnpm tauri dev`. A script rather than an inline env assignment because
  the var is read by the *Rust* process (so `.env.local`, being Vite-only, can't
  deliver it) and `FOO=bar cmd` is POSIX-only syntax that breaks under the
  cmd.exe pnpm uses on Windows. Pre-flights the port: WebView2 silently ignores
  an already-bound `--remote-debugging-port`, leaving a dead endpoint, so the
  clash is caught up front instead.
- **`package.json`** — `dev:agent-browser` script.
- **`.mcp.json`** — registers `preview-browser` =
  `npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222`.
  `--cdp-endpoint` → `chromium.connectOverCDP`, ownership `attached`: the MCP
  server does not own the browser lifecycle, which is right — terax does.
  Port is hardcoded to 9222 here; `--port=` overrides need a matching edit.

Verify: open a Preview tab, then ask the agent for `browser_snapshot`,
`browser_click`, `browser_take_screenshot`, scroll.

Delivers: click / type / scroll / screenshot / a11y-snapshot / in-page navigate.
Does **not** deliver: creating or closing terax Preview tabs (CDP
`Target.createTarget` makes an orphan target, not a terax tab).

### Phase 1 risks — measured against the release build (2026-07-25)

- **Screenshots require focus. Confirmed, and worse than predicted.** A hidden
  preview webview stops compositing entirely, so `Page.captureScreenshot` never
  resolves — the tool **times out at 5s** rather than returning a blank image.
  Measured with three Preview tabs open: only the frontmost one screenshotted;
  the other two timed out. Everything else (DOM read, `evaluate`, click,
  navigate) works fine on a background tab. `preview_focus_tab`'s description
  now states this as a requirement.
- **`record_nav` DOES follow CDP-initiated navigation. Confirmed.** Driving the
  frontmost tab `google.com` → `example.org` via Playwright updated terax's
  address bar and enabled Back. The wry navigation handler fires regardless of
  who started the navigation, so an agent browsing keeps the tab's address bar
  and history in sync — no desync, no extra plumbing needed.
- Windows-only: `additional_browser_args` is a no-op on macOS/Linux.

### Event-spoofing escalation — found and fixed (2026-07-25)

Preview webviews hold `preview-key-forward`, granting `core:event:allow-emit`
so the page can forward host shortcuts. **Tauri does not scope emit by event
name.** Once `useAgentPreviewBridge` began listening on `terax:agent-preview`,
any remote page in a Preview tab could emit that event and drive tab
open/close/focus/navigate — with no bridge, no bearer token, and no CDP. It
applied even with agent mode off, since the hook mounts unconditionally.

Confirmed by exploit against the release build: a page-emitted `open` created a
real Preview tab. That tab then **persisted into saved tab state and survived
two rebuilds and restarts** — the effect was durable, not transient.

Fix: the bridge stamps its token into every emitted action; the frontend
rejects anything without a match, reading the expected value from
`agent_bridge_info` — a *command*, and previewed pages are ACL-denied on
commands (verified: `agent_bridge_info`, `agent_bridge_report_tabs`,
`preview_open`, `fs_read_file`, `pty_open`, `get_launch_dir` all denied). Plus
http(s) validation on the event-driven `open`/`navigate` paths, which reach
`newPreviewTab` directly and would otherwise bypass the Rust-side check.

Re-verified against a rebuilt release binary: identical exploit, all four
actions emitted successfully and **none honoured**.

**Residual risk:** this is application-layer defence. The primitive is still
unscoped — any *future* listener on an emit-able event has the same exposure
unless it authenticates too. The structural fix is to move privileged actions
off the event channel entirely (frontend polls a command the page cannot
invoke). Not done; flagged for Phase 3.

**Lesson:** the capability's description asserted a previewed page "can at most
spoof a shortcut event." Adding a listener silently falsified that, and nothing
caught it — not tsc, not the test suite, not the earlier release verification,
all of which passed while the hole was open. Only probing the attack found it.

### Verified in the release build

- Gating holds: with no env vars, port 9222 is not listening and the app binds
  **no** listening socket at all. With them set, the bridge binds an ephemeral
  loopback port and 9222 opens on the first Preview tab (owned by the WebView2
  browser process, not the app).
- Bridge auth: missing, wrong, and malformed bearer tokens all get
  `401 {"error":"unauthorized"}`, including on the mutating `POST /open`.
- `window.__TERAX_TAB_ID` is injected and unique per tab, and
  `window.__TAURI__` is `undefined` in previewed pages — the IPC-isolation
  invariant, confirmed at runtime rather than only at source level.
- The join key earns its place: CDP page order (0,1,2) did **not** match terax
  tab order (`preview-42`, `preview-40`, `preview-41`). Matching by index or
  URL would have picked the wrong tab.

---

## Phase 2 — tab lifecycle  ✅ built

CDP cannot create terax tabs, so terax exposes a control channel.

- **`src-tauri/src/modules/agentbridge.rs`** — loopback HTTP/1.1 server on
  `127.0.0.1:0` behind a bearer token, hand-rolled on the tokio listener
  `mirror.rs` already demonstrates (no new crates). Routes: `GET /tabs`,
  `POST /open|navigate|close|focus`. Binds only when
  `TERAX_PREVIEW_DEBUG_PORT` is set — one switch for both CDP and tab control.
  Exports `TERAX_BRIDGE_URL` / `TERAX_BRIDGE_TOKEN` into the terax process env,
  which every PTY (and therefore every agent) inherits: no user setup, and no
  change to the shell spawn path.
- **`src/modules/preview/lib/useAgentPreviewBridge.ts`** — the frontend half.
  Pushes a tab snapshot on every change (what `GET /tabs` serves) and performs
  incoming actions through the *same* callbacks the UI uses
  (`openPreviewTab` / `disposeTab` / `jumpToTab`), so an agent-opened tab is
  indistinguishable from a user-opened one.
- **`preview.rs`** — injects `window.__TERAX_TAB_ID` (the webview label) into
  every preview page. This is the join key: Playwright sees an unordered set of
  pages identified only by title and URL, neither of which maps back to a terax
  tab. The agent evaluates `window.__TERAX_TAB_ID` and matches it against
  `webviewLabel` from `preview_list_tabs`. Page-writable, so it identifies —
  it never authenticates.
- **`mcp/terax-preview/server.mjs`** — dependency-free stdio MCP server
  (JSON-RPC 2.0, MCP 2024-11-05): `preview_list_tabs`, `preview_open_tab`,
  `preview_navigate_tab`, `preview_focus_tab`, `preview_close_tab`.
- **`.mcp.json`** — registers it alongside `preview-browser`.

Two MCP servers by design: Playwright owns in-page interaction (mature, free),
terax owns tab lifecycle (only terax can).

### Disambiguation

The agent asks, terax does not. `preview_list_tabs` returns `focused`, and the
tool descriptions instruct: act on the focused tab when unambiguous, otherwise
ask the user by title + URL rather than guessing. No new UI, and it works with
any MCP client.

### `requestId` round-trip

`POST /open` returns 202 — the emit to the frontend is fire-and-forget, so the
bridge cannot know the new tab's id. The caller sends a `requestId`; the
frontend records it against the id it assigns and echoes it on the next
snapshot; `preview_open_tab` polls `/tabs` until it appears (5s). Matching on
URL instead would pick the wrong tab whenever two tabs share one.

---

## Phase 3 — hardening before this ships to users

- Auto-allocate a free debug port at startup instead of a fixed 9222.
- Off by default; per-session UI toggle opens the port and enables the bridge.
- Loopback CDP is **unauthenticated** — anything local can attach and drive any
  Preview tab. Acceptable in dev; for release either keep it toggle-gated or
  migrate in-page control to Path B (`ICoreWebView2::CallDevToolsProtocolMethod`
  via `webview.with_webview()`), which needs no open port.
