# Plan: Ctrl+Shift+T → DashboardPlusPlus mirror tab

**Goal**: Repurpose Ctrl+Shift+T (currently `tab.newBlock`, New Blocks terminal) to open a new
`device-mirror` tab that shows the DashboardPlusPlus app running on the Samsung A55 phone,
via ADB + scrcpy protocol, rendered inside the tab.

**Confirmed decisions**
- Approach: screen mirror (user), phone not always connected via ADB → tab must handle offline state.
- Rebind Ctrl+Shift+T: yes. Blocks terminal stays via command palette (`tab.newBlock`).
- Defaults pending user confirmation (chosen as recommended): ya-webadb in-tab rendering, full input control.

**Environment (verified 2026-07-03)**
- adb on PATH: `C:\Users\frpag\AppData\Local\Android\Sdk\platform-tools\adb.exe` (v37.0.0).
- terax-ai: Tauri 2 + React 19 + Vite 8.
- Phone: Samsung A55 (Android 14 → native Wireless debugging support).

## Phases

### 1. Tab scaffold + rebind
- New tab kind `device-mirror` in tabs store (`src/modules/tabs/lib/useTabs.ts`), render branch in
  `src/app/components/WorkspaceSurface.tsx`.
- Shortcut: change `tab.newBlock` default binding (shortcuts.ts:104) → new action `tab.deviceMirror`
  with `Ctrl+Shift+T`; `tab.newBlock` loses default binding but stays rebindable + in command palette.
- Command palette entry (`src/modules/command-palette/commands.ts`).

### 2. ADB connection manager (Rust/Tauri side)
- Tauri command wrapping adb: locate adb (PATH → ANDROID_SDK fallback), `adb devices` poll or
  `adb track-devices` stream → device status events to frontend.
- Connectivity: phone + laptop share a **Tailscale tailnet** → primary endpoint is the phone's
  tailnet address (MagicDNS name or 100.x.y.z IP), stable across Wi-Fi/cellular. `adb connect
  <tailnet-addr>:5555` works from anywhere both are online.
- Bootstrap: `adb tcpip 5555` once over USB (persists until phone reboot; after reboot, replug once
  or toggle Wireless debugging). Fixed port 5555 preferred — Wireless-debugging's rotating port +
  mDNS discovery don't traverse tailnet (mDNS is link-local).
- Persist tailnet endpoint in settings store; auto `adb connect` on tab open + retry loop.
- Latency note: if Tailscale falls back to DERP relay, stream lags — expose bitrate/size caps.

### 3. Stream bridge
- ya-webadb (`@yume-chan/adb`, `@yume-chan/scrcpy`, `@yume-chan/adb-scrcpy`) as client.
- Browser can't open raw TCP → small Rust TCP↔IPC proxy to local adb server (127.0.0.1:5037);
  implement `AdbServerClient` transport over it (or WebSocket bridge).
- Bundle scrcpy-server jar version matching @yume-chan/scrcpy; push + start per session.

### 4. Rendering + input
- Decode H.264 with WebCodecs `VideoDecoder` (ya-webadb decoder package), draw to canvas in tab.
- Full control: forward mouse/touch/keyboard via scrcpy control channel.
- Risk check first: verify WebCodecs H.264 available in WebView2 (spike before committing).

### 5. Offline/placeholder UX
- Tab always opens. No device → status panel: connection state, stored IP quick-connect button,
  pairing wizard (code entry), auto-retry poll. Mirror swaps in when device appears.
- Handle disconnect mid-stream → back to placeholder, auto-reconnect attempts.

### 6. Polish
- Settings section (phone IP, resolution/bitrate caps for perf).
- Tab title/icon; restore-on-startup behavior consistent with other tab kinds.

## Risks
- WebCodecs H.264 in WebView2 — spike in Phase 4; fallback = ws-scrcpy sidecar in preview tab.
- `tcpip 5555` resets on phone reboot → needs one-time USB replug (or Wireless debugging toggle) to re-arm; placeholder UI should say so.
- adbd on :5555 is unauthenticated-network-exposed; acceptable since reachability is tailnet-gated (keep Tailscale ACLs tight).
- scrcpy-server ↔ client version coupling — pin versions together.

## Open questions (defaults applied, revisit if wrong)
1. Mirror tech: ya-webadb in-tab (default) vs ws-scrcpy sidecar vs external scrcpy window.
2. Interaction: full control (default) vs view-only.
3. Phone + PC same Wi-Fi usually? (assumed yes; USB `tcpip 5555` bootstrap documented either way)
