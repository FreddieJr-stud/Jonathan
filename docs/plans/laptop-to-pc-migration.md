# Migrating spaces / AI sessions / preview logins from laptop to PC

This PC has a fresh `git clone` of the laptop's Jonathan checkout. Cloning the
repo does **not** bring over spaces, AI chat history, or preview-panel
WebView2 logins/cookies — none of that lives inside the project directory or
in git. It lives per-machine in Tauri's app-data dirs, keyed off the app
identifier `app.crynta.terax` (`src-tauri/tauri.conf.json`).

## Where the real data lives

| What | Path | Written by |
|---|---|---|
| Spaces (tabs/panes) + AI chat sessions | `%APPDATA%\app.crynta.terax\` — `terax-spaces.json` / `terax-ai-sessions.json` (legacy shared) and/or `terax-spaces-<hash>.json` / `terax-ai-sessions-<hash>.json` (per-project-window) | `src/modules/spaces/lib/store.ts`, `src/modules/ai/lib/sessions.ts` (Tauri store plugin) |
| Preview-panel WebView2 logins/cookies | `%LOCALAPPDATA%\app.crynta.terax\preview-webview\` | `src-tauri/src/modules/preview.rs:276-296` (pinned WebView2 profile folder) |

Two sources of cross-machine inconsistency to expect:

1. **Per-window filenames are a hash of the project's launch dir path**
   (`src/lib/storeScope.ts`, djb2 hash of `getLaunchDir()` from
   `src/lib/launchDir.ts`). Laptop and PC project paths differ, so the hash —
   and therefore the filename — differs too. There's a built-in fallback: if
   a per-window store is empty on load, the app migrates from the unsuffixed
   legacy file (`600fd32`, "Migrate legacy shared spaces/sessions store into
   per-window files") — so shipping the legacy files across and opening the
   matching project should self-heal the filename mismatch.
2. **Each space also carries its own `root` path** (project folder) inside
   the JSON (`SpaceMeta.root` in `store.ts`). That still points at the
   laptop's filesystem (e.g. NOAH's project folder) and needs manual
   correction to the PC's equivalent path after the data lands — filenames
   resolving correctly doesn't fix this.

## Steps (do this on the laptop, agent)

1. **Close Jonathan first** — both the store files and the WebView2 profile
   can be mid-write or locked while the app is running.
2. Copy these two folders off the laptop:
   - `%APPDATA%\app.crynta.terax\` (all `terax-spaces*.json` /
     `terax-ai-sessions*.json` files — include the **unsuffixed** legacy
     ones, not just hashed variants, since that's what the auto-migration
     reads from)
   - `%LOCALAPPDATA%\app.crynta.terax\preview-webview\` (WebView2 profile:
     cookies, localStorage, IndexedDB for the in-app preview browser)
3. Transfer both folders to the PC (USB drive / shared cloud folder / network
   share — whatever's available between the two machines).

## Steps (on the PC)

1. Before pasting, if `%APPDATA%\app.crynta.terax\` or
   `%LOCALAPPDATA%\app.crynta.terax\preview-webview\` already exist here
   (e.g. from a prior run of the app on this PC), back them up first —
   don't overwrite blind.
2. Paste the laptop's folders into the matching locations on this PC.
3. Launch Jonathan, open each project — the legacy-file fallback should
   populate spaces/sessions per window automatically.
4. Manually fix each space's `root` path (e.g. NOAH) to the PC's equivalent
   project folder — either through the app UI or by editing the JSON
   directly. Not automated; paths aren't derivable machine-to-machine.

## Known limitation: WebView2 login/cookie portability

Chromium (which WebView2 is built on) encrypts cookie values with Windows
DPAPI keyed to the *originating machine + user account*. Copying
`preview-webview` to a different PC often does **not** restore logged-in
sessions — WebView2 typically discards cookies it can't decrypt and the site
just prompts a fresh login. Copy the folder anyway (agreed best-effort), but
don't treat a failed auto-login as a bug — it's expected, and manual
re-login is the fallback.
