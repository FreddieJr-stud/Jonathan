//! Native embedded webview backing the Preview tab — a real browser surface
//! (handles X-Frame-Options sites, in-page navigation, history) that an
//! `<iframe>` cannot provide. Each preview tab owns one child webview of the
//! main window, labelled `preview-<tabId>`, positioned over a measured DOM rect
//! by the frontend.
//!
//! Uses Tauri's multiwebview API (`Window::add_child`), gated behind the
//! `unstable` Cargo feature. Child webviews load arbitrary remote URLs and are
//! intentionally NOT listed in any capability, so they receive no Tauri IPC
//! (`window.__TAURI__` is absent on the previewed page).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

/// Injected into every preview webview before page scripts run. Mirrors a
/// committed text selection into the clipboard (highlight-to-copy), matching the
/// host-side `useCopyOnSelect` for HTML surfaces. Fires on `mouseup` (the
/// highlight gesture provides the user activation `clipboard.writeText` wants)
/// and on shift-keyed `keyup`; never on plain typing. Best-effort — clipboard
/// denial in a cross-origin frame is swallowed.
///
/// `window.getSelection()` does NOT pierce shadow roots, so on web-component
/// apps (e.g. Google Calendar) the document selection reads empty even while
/// text is visibly highlighted — and `navigator.clipboard.writeText` may be
/// rejected outright by the page's permissions posture. So the primary path is
/// `document.execCommand("copy")`: the exact mechanism Ctrl+C uses, which copies
/// the browser's *real* global selection regardless of which (shadow) tree it
/// lives in. `readSelection` + `writeText` is only the fallback for the rare
/// engine where execCommand("copy") is unavailable.
const COPY_ON_SELECT_JS: &str = r#"
(function () {
  var readSelection = function () {
    try {
      var sel = (window.getSelection && window.getSelection().toString()) || "";
      if (sel.trim()) return sel;
    } catch (e) {}
    // getSelection() can't see inside shadow roots; ask the active element's
    // root (and walk nested shadow roots) for its own Selection.
    try {
      var node = document.activeElement;
      while (node) {
        var root = node.shadowRoot;
        if (root && typeof root.getSelection === "function") {
          var s = root.getSelection().toString();
          if (s && s.trim()) return s;
          node = root.activeElement;
          continue;
        }
        break;
      }
    } catch (e) {}
    return "";
  };
  var copy = function () {
    // Bail on plain clicks (collapsed selection) so we never clobber the
    // clipboard. Note: a shadow-tree selection is invisible here, so when the
    // document selection is collapsed we still attempt execCommand below — it
    // is a no-op when there is genuinely nothing selected.
    try {
      // Primary: mirror Ctrl+C exactly. Copies the native selection (incl.
      // shadow DOM); the highlight gesture supplies the needed user activation.
      if (document.execCommand && document.execCommand("copy")) return;
    } catch (e) {}
    // Fallback: read the selection ourselves and write it via the async API.
    try {
      var sel = readSelection();
      if (sel.trim() && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sel).catch(function () {});
      }
    } catch (e) {}
  };
  document.addEventListener("mouseup", copy, true);
  document.addEventListener("keyup", function (e) {
    if (e.shiftKey || e.key === "Shift") copy();
  }, true);
})();
"#;

/// Forwards host keyboard shortcuts out of the previewed page so they keep
/// working while a Preview tab holds focus (the native child webview owns its
/// own keyboard input, so the host `window` keydown listener never sees it).
///
/// Only combos present in `window.__TERAX_COMBOS` — the exact set of active host
/// shortcut bindings, pushed by the frontend — are intercepted; everything else
/// (typing, Ctrl+C/V/X/A, in-page Ctrl+F, …) is left untouched for the page.
/// Matched combos are `preventDefault`ed and emitted to the host as
/// `terax:preview-key`, which the host replays through its shortcut matcher.
///
/// This is the one capability granted to the otherwise IPC-less preview webview
/// (`capabilities/preview-key-forward.json`): event emit ONLY — no command
/// access — so a previewed page can at most spoof a shortcut event, never reach
/// the filesystem, shell, or any Tauri command.
const KEY_FORWARD_JS: &str = r#"
(function () {
  var I = window.__TAURI_INTERNALS__;
  if (!I || typeof I.invoke !== "function") return;
  if (window.__teraxKeyFwd) return;
  window.__teraxKeyFwd = true;
  window.__TERAX_COMBOS = window.__TERAX_COMBOS || [];
  function hit(e) {
    var list = window.__TERAX_COMBOS || [];
    var k = (e.key || "").toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (k !== c.key) continue;
      if (!!e.ctrlKey !== !!c.ctrl) continue;
      if (!!e.shiftKey !== !!c.shift) continue;
      if (!!e.altKey !== !!c.alt) continue;
      if (!!e.metaKey !== !!c.meta) continue;
      return true;
    }
    return false;
  }
  window.addEventListener("keydown", function (e) {
    if (!hit(e)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      I.invoke("plugin:event|emit", {
        event: "terax:preview-key",
        payload: {
          key: (e.key || "").toLowerCase(),
          code: e.code,
          ctrl: !!e.ctrlKey,
          shift: !!e.shiftKey,
          alt: !!e.altKey,
          meta: !!e.metaKey
        }
      });
    } catch (err) {}
  }, true);
})();
"#;

/// Forces horizontal scrolling on the Gmail mini panel (`preview-gmail`).
/// Gmail's desktop UI doesn't reflow below ~700px — it just lets its columns
/// overflow the viewport — and WebView2 shows no scrollbar for that overflow
/// by default, so at panel widths under Gmail's minimum the extra columns
/// are invisible rather than merely narrow. This makes that overflow
/// scrollable instead, so the whole page is still reachable at any panel
/// width, not just once it's dragged wide enough.
const GMAIL_HSCROLL_JS: &str = r#"
(function () {
  function inject() {
    var style = document.createElement("style");
    style.textContent = "html, body { overflow-x: auto !important; }";
    document.head.appendChild(style);
  }
  if (document.head) inject();
  else document.addEventListener("DOMContentLoaded", inject);
})();
"#;

/// The browser args wry passes to WebView2 by default. `additional_browser_args`
/// *replaces* them rather than appending, so any override has to restate them or
/// the preview webviews silently lose SmartScreen and the out-of-process UI
/// suppression every other install gets.
const WRY_DEFAULT_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Opt-in Chrome DevTools Protocol endpoint for preview webviews, enabled by
/// setting `TERAX_PREVIEW_DEBUG_PORT` to a port number before launching the app.
/// TEMP: restored for a one-off debug session; revert before committing.
fn debug_browser_args() -> Option<String> {
    let raw = std::env::var("TERAX_PREVIEW_DEBUG_PORT").ok()?;
    let port: u16 = raw.trim().parse().ok()?;
    if port == 0 {
        return None;
    }
    Some(format!(
        "{WRY_DEFAULT_BROWSER_ARGS} --remote-debugging-port={port}"
    ))
}

/// Holds the JSON array of active host shortcut combos (`{key,ctrl,shift,alt,
/// meta}`) so it can be baked into every preview webview's init scripts at
/// creation and updated live via `preview_set_key_combos`.
pub struct PreviewKeys(pub Mutex<String>);

impl Default for PreviewKeys {
    fn default() -> Self {
        PreviewKeys(Mutex::new("[]".to_string()))
    }
}

/// Per-label navigation history, used to drive Back/Forward availability.
struct Nav {
    history: Vec<String>,
    index: usize,
}

#[derive(Default)]
pub struct PreviewState(Mutex<HashMap<String, Nav>>);

/// A `window.open()` from a previewed page, forwarded to the frontend so it can
/// open the URL as a new Preview tab (see `on_new_window` in `preview_open`).
#[derive(Clone, Serialize)]
struct PopupEvent {
    url: String,
}

#[derive(Clone, Serialize)]
struct NavEvent {
    label: String,
    url: String,
    #[serde(rename = "canGoBack")]
    can_go_back: bool,
    #[serde(rename = "canGoForward")]
    can_go_forward: bool,
}

/// Records a navigation against the label's history and emits the current
/// address-bar state. `on_navigation` fires for every navigation — link click,
/// JS redirect, or our own `history.back()/forward()` — and doesn't say which,
/// so we infer Back/Forward by matching the new URL against the adjacent
/// history entry; anything else truncates the forward stack and appends.
fn record_nav(app: &AppHandle, label: &str, url: &str) {
    let state = app.state::<PreviewState>();
    let mut map = state.0.lock().expect("PreviewState poisoned");
    let nav = map.entry(label.to_string()).or_insert_with(|| Nav {
        history: Vec::new(),
        index: 0,
    });
    if nav.history.is_empty() {
        nav.history.push(url.to_string());
        nav.index = 0;
    } else if nav.index > 0 && nav.history[nav.index - 1] == url {
        nav.index -= 1;
    } else if nav.index + 1 < nav.history.len() && nav.history[nav.index + 1] == url {
        nav.index += 1;
    } else if nav.history[nav.index] != url {
        nav.history.truncate(nav.index + 1);
        nav.history.push(url.to_string());
        nav.index = nav.history.len() - 1;
    }
    let ev = NavEvent {
        label: label.to_string(),
        url: url.to_string(),
        can_go_back: nav.index > 0,
        can_go_forward: nav.index + 1 < nav.history.len(),
    };
    drop(map);
    let _ = app.emit("terax:preview-nav", ev);
}

/// Creates (or re-targets) the child webview for `label` at the given logical
/// rect and points it at `url`.
#[tauri::command]
pub async fn preview_open(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;

    // Already created (e.g. tab re-shown): just reposition + navigate.
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
        let _ = webview.navigate(parsed);
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // Pin every preview webview to one explicit, persistent WebView2 user-data
    // folder. Using a stable path (rather than relying on Tauri's default):
    //   - persists cookies / localStorage / sessions across app restarts,
    //     reboots, tab close+reopen, and Tauri version bumps;
    //   - shares one profile across all `preview-*` webviews, so signing into a
    //     site in one preview tab carries to every other preview tab;
    //   - resolves to the same folder in `tauri dev` and the bundled release
    //     (both keyed off the app identifier), so a login survives that switch.
    // WebView2 keys its web-context store by this directory, so an identical
    // path is what makes the session shared rather than isolated.
    let debug_args = debug_browser_args();
    let profile = if debug_args.is_some() {
        "preview-webview-debug"
    } else {
        "preview-webview"
    };
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join(profile);
    // WebView2 creates the folder itself, but ensure the parent chain exists so
    // a fresh profile (or a custom relocated data dir) can't fail the build.
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        return Err(format!("failed to create preview data dir: {e}"));
    }

    let app_for_nav = app.clone();
    let label_for_nav = label.clone();
    let app_for_popup = app.clone();
    let app_for_download = app.clone();
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .data_directory(data_dir)
        // wry defaults this off. It gates both WebView2's ctrl+scroll/ctrl+=/-
        // zoom *and* trackpad pinch-zoom (`IsZoomControlEnabled` /
        // `IsPinchZoomEnabled`) — left false, pinch silently does nothing on
        // a previewed page even though nothing else in this file touches it.
        .zoom_hotkeys_enabled(true)
        .on_navigation(move |u| {
            // Only http(s) — never let a previewed page jump to file:, tauri:,
            // or custom schemes that could touch local resources.
            if u.scheme() != "http" && u.scheme() != "https" {
                return false;
            }
            record_nav(&app_for_nav, &label_for_nav, u.as_str());
            true
        })
        // A previewed page calling `window.open()` (e.g. Gmail "compose in new
        // window", attachment preview) requests a popup the child webview has no
        // surface for — left unhandled, WebView2 silently blocks it and the page
        // reports "a popup blocker may be preventing the application…". Instead
        // we Deny the native popup (which keeps the opener page alive) and hand
        // the URL to the frontend, which opens it as a new Preview tab. We never
        // use `NewWindowResponse::Create` here: building a webview inside this
        // synchronous handler can deadlock WebView2 on Windows, and an OS window
        // would float outside the Preview pane anyway.
        .on_new_window(move |url, _features| {
            if url.scheme() == "http" || url.scheme() == "https" {
                let _ = app_for_popup.emit(
                    "terax:preview-popup",
                    PopupEvent {
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        // Copy-on-select inside the previewed page. The native webview is a
        // separate process, so the host's `useCopyOnSelect` can't see its
        // selection — this script runs in the page's own context and mirrors
        // any highlighted text into the clipboard, matching the rest of the app.
        .initialization_script(COPY_ON_SELECT_JS)
        // Seed the active shortcut combos, then install the key-forwarder. Both
        // re-run on every navigation, so shortcuts keep working as the user
        // browses within the preview tab.
        .initialization_script(&format!(
            "window.__TERAX_COMBOS = {};",
            current_key_combos(&app)
        ))
        .initialization_script(KEY_FORWARD_JS)
        // Stamp the owning tab's webview label into the page so an agent driving
        // this webview over CDP can tell *which* Preview tab it is looking at.
        // Playwright sees an unordered set of pages identified only by title and
        // URL — neither of which maps back to a terax tab (two tabs can sit on
        // the same URL, and a tab's alias is host-side state the page never
        // sees). Reading `window.__TERAX_TAB_ID` gives an exact join key against
        // what the agent bridge reports. A page can trivially overwrite this, so
        // it is an identification aid, never a trust signal.
        .initialization_script(&format!(
            "window.__TERAX_TAB_ID = {};",
            serde_json::to_string(&label).unwrap_or_else(|_| "null".into())
        ))
        // Downloads are redirected into the app's staging area and announced to
        // the frontend, which prompts for what to do with the file. Both arms
        // run on the WebView2 UI thread, so neither may block (see
        // `modules/download.rs` for why the prompt can't happen up front).
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { destination, .. } => {
                crate::modules::download::on_requested(&app_for_download, destination)
            }
            DownloadEvent::Finished { url, path, success } => {
                crate::modules::download::on_finished(
                    &app_for_download,
                    url.to_string(),
                    path,
                    success,
                );
                true
            }
            _ => true,
        });

    if label == "preview-gmail" {
        builder = builder.initialization_script(GMAIL_HSCROLL_JS);
    }

    if let Some(args) = debug_args {
        builder = builder.additional_browser_args(&args);
    }

    // Dev-only: widen the window between "create dispatched" and "webview
    // exists" so the frontend's ordering around it can be exercised by hand.
    //
    // `preview_hide` and `preview_close` both no-op while the webview does not
    // exist yet, and `add_child` then creates it VISIBLE — so a hide or close
    // issued during the create is silently dropped, and the native layer ends up
    // painted over the whole app (see the `.then()` in PreviewPane's
    // `openWebview`). That window is normally a few hundred milliseconds, which
    // makes the bug a coin flip to reproduce and impossible to prove fixed.
    // Widening it to seconds makes both failures deterministic.
    if let Some(ms) = std::env::var("TERAX_PREVIEW_OPEN_DELAY_MS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|ms| *ms > 0)
    {
        log::warn!("preview: delaying webview create by {ms}ms (TERAX_PREVIEW_OPEN_DELAY_MS)");
        tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
    }

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    // WebView2 defaults AreBrowserAcceleratorKeysEnabled to true, which
    // reserves keys like Ctrl+D for browser chrome this app never shows and
    // swallows them before they reach the DOM — silently defeating both
    // KEY_FORWARD_JS below and the page's own handler for the same key. Best
    // effort: a previewed page just keeps its default WebView2 behavior if
    // this fails, nothing else here depends on it.
    match crate::modules::preview_capture::disable_accelerator_keys(app.clone(), label.clone())
        .await
    {
        Ok(()) => log::info!("preview: disabled browser accelerator keys for {label}"),
        Err(e) => log::warn!("preview: failed to disable browser accelerator keys for {label}: {e}"),
    }

    Ok(())
}

/// Minimum gap between two `navigate()` calls on the same webview.
///
/// Double-clicking a reload button fires two commands within a few
/// milliseconds. Each lands on `ICoreWebView2::Navigate` from a Tokio worker
/// thread while the previous navigation is still starting, and WebView2 wedges
/// its UI thread — the app hangs with no crash and no log. 400ms is far longer
/// than a double-click and far shorter than any intentional re-navigate.
const NAV_THROTTLE: std::time::Duration = std::time::Duration::from_millis(400);

/// Last accepted `navigate()` per label. A module-level static rather than
/// managed state so the guard can't be defeated by forgetting to register it.
fn nav_throttle() -> &'static Mutex<HashMap<String, std::time::Instant>> {
    static T: std::sync::OnceLock<Mutex<HashMap<String, std::time::Instant>>> =
        std::sync::OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}

/// True if `label` navigated within `NAV_THROTTLE`; records the attempt when it
/// is allowed through. Poisoning is treated as "allow" — the guard is an
/// optimization, never a correctness gate.
fn nav_too_soon(label: &str) -> bool {
    let now = std::time::Instant::now();
    let Ok(mut map) = nav_throttle().lock() else {
        return false;
    };
    if let Some(prev) = map.get(label) {
        if now.duration_since(*prev) < NAV_THROTTLE {
            return true;
        }
    }
    map.insert(label.to_string(), now);
    false
}

#[tauri::command]
pub async fn preview_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    // No-op if not created yet (bounds/show effects can race ahead of the
    // async preview_open; add_child already places it visible at the rect).
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    // Drop re-entrant navigations (double-clicked reload) — see `NAV_THROTTLE`.
    // Reported as success: the user asked for this URL and it is already being
    // loaded, so surfacing an error would be a lie.
    if nav_too_soon(&label) {
        return Ok(());
    }
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_back(app: AppHandle, label: String) -> Result<(), String> {
    // No-op if not created yet (bounds/show effects can race ahead of the
    // async preview_open; add_child already places it visible at the rect).
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    webview.eval("history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_forward(app: AppHandle, label: String) -> Result<(), String> {
    // No-op if not created yet (bounds/show effects can race ahead of the
    // async preview_open; add_child already places it visible at the rect).
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    webview.eval("history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_set_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // No-op if not created yet (bounds/show effects can race ahead of the
    // async preview_open; add_child already places it visible at the rect).
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    let _ = webview.set_position(LogicalPosition::new(x, y));
    let _ = webview.set_size(LogicalSize::new(width, height));
    Ok(())
}

#[tauri::command]
pub async fn preview_show(app: AppHandle, label: String) -> Result<(), String> {
    // No-op if not created yet (bounds/show effects can race ahead of the
    // async preview_open; add_child already places it visible at the rect).
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    webview.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_hide(app: AppHandle, label: String) -> Result<(), String> {
    // No-op if not created yet (bounds/show effects can race ahead of the
    // async preview_open; add_child already places it visible at the rect).
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    webview.hide().map_err(|e| e.to_string())
}

/// Current shortcut combos as a JSON array string (`"[]"` until the frontend
/// first pushes them). Safe to interpolate straight into JS — it's JSON.
fn current_key_combos(app: &AppHandle) -> String {
    app.state::<PreviewKeys>()
        .0
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "[]".to_string())
}

/// Push the active host shortcut combos to every live preview webview and store
/// them for webviews created later. `combos` is a JSON array of
/// `{key,ctrl,shift,alt,meta}` produced by the frontend.
#[tauri::command]
pub async fn preview_set_key_combos(app: AppHandle, combos: String) -> Result<(), String> {
    {
        let state = app.state::<PreviewKeys>();
        let mut slot = state.0.lock().expect("PreviewKeys poisoned");
        *slot = combos.clone();
    }
    let js = format!("window.__TERAX_COMBOS = {combos};");
    for (label, webview) in app.webviews() {
        if label.starts_with("preview-") {
            let _ = webview.eval(&js);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_close(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
    }
    app.state::<PreviewState>()
        .0
        .lock()
        .expect("PreviewState poisoned")
        .remove(&label);
    // Drop the throttle entry too, so a close+recreate (the reload escalation
    // in PreviewPane) can navigate immediately instead of being swallowed as a
    // re-entrant call against the destroyed webview's timestamp.
    if let Ok(mut map) = nav_throttle().lock() {
        map.remove(&label);
    }
    Ok(())
}
