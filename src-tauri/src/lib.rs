pub mod modules;

use modules::{
    agent, archive, download, fs, git, history, mirror, net, preview,
    preview_capture, pty, secrets, shell, snippet, tailscale, toast, workspace,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::PhysicalPosition;
use tauri_plugin_window_state::StateFlags;

/// Drained on first read (per window) so HMR / re-mounts can't replay the
/// launch dir, and so a 2nd project window sharing this process (single
/// instance) doesn't get handed the 1st window's directory.
#[derive(Default)]
struct LaunchDir(Mutex<HashMap<String, String>>);

#[tauri::command]
fn get_launch_dir(window: tauri::Window, state: State<'_, LaunchDir>) -> Option<String> {
    state
        .0
        .lock()
        .expect("LaunchDir mutex poisoned")
        .remove(window.label())
}

/// Tracks the open project windows in this (now single-instance) process:
/// which canonical directory maps to which window label, so relaunching an
/// already-open project focuses it instead of opening a duplicate, and which
/// window was last focused, so the bring-forward hotkey/toast/Settings have
/// something other than a hardcoded "main" to target.
pub(crate) struct WindowRegistry {
    by_dir: Mutex<HashMap<PathBuf, String>>,
    last_focused: Mutex<Option<String>>,
    next_index: AtomicU32,
}

impl Default for WindowRegistry {
    fn default() -> Self {
        Self {
            by_dir: Mutex::new(HashMap::new()),
            last_focused: Mutex::new(None),
            // Starts at 2 -- "main" is window #1 in spirit, even though it
            // isn't tracked by index.
            next_index: AtomicU32::new(2),
        }
    }
}

impl WindowRegistry {
    pub(crate) fn next_label(&self) -> String {
        format!("project-{}", self.next_index.fetch_add(1, Ordering::Relaxed))
    }

    fn register(&self, dir: Option<&str>, label: &str) {
        if let Some(canon) = dir.and_then(|d| std::fs::canonicalize(d).ok()) {
            self.by_dir.lock().unwrap().insert(canon, label.to_string());
        }
    }

    fn unregister(&self, label: &str) {
        self.by_dir.lock().unwrap().retain(|_, l| l != label);
        let mut last = self.last_focused.lock().unwrap();
        if last.as_deref() == Some(label) {
            *last = None;
        }
    }

    pub(crate) fn label_for_dir(&self, dir: &str) -> Option<String> {
        std::fs::canonicalize(dir)
            .ok()
            .and_then(|canon| self.by_dir.lock().unwrap().get(&canon).cloned())
    }

    fn set_focused(&self, label: &str) {
        *self.last_focused.lock().unwrap() = Some(label.to_string());
    }

    /// Last-focused project window's label, falling back to "main" before
    /// any Focused event has fired yet (e.g. hotkey pressed immediately at
    /// startup).
    pub(crate) fn focused_or_main(&self) -> String {
        self.last_focused
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "main".to_string())
    }
}

fn parse_launch_dir_from(args: impl IntoIterator<Item = String>) -> Option<String> {
    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        return Some(crate::modules::fs::to_canon(&canon));
    }
    None
}

fn parse_launch_dir() -> Option<String> {
    parse_launch_dir_from(std::env::args().skip(1))
}

/// Creates a new project window (the initial "main" one at startup, or an
/// additional one when the single-instance plugin routes a 2nd launch into
/// this process instead of spawning a new Jonathan.exe). Every per-window
/// piece of state (launch cwd, workspace registry authorization, the
/// dir->label registry, the LaunchDir handoff to the frontend) is wired up
/// here so both call sites stay in sync.
fn create_project_window(
    app: &tauri::AppHandle,
    label: &str,
    launch_dir: Option<String>,
) -> tauri::Result<tauri::WebviewWindow> {
    workspace::init_launch_cwd(label, launch_dir.as_deref());
    workspace::bootstrap_registry(&app.state::<workspace::WorkspaceRegistry>(), label);
    app.state::<WindowRegistry>().register(launch_dir.as_deref(), label);
    if let Some(dir) = launch_dir {
        app.state::<LaunchDir>()
            .0
            .lock()
            .expect("LaunchDir mutex poisoned")
            .insert(label.to_string(), dir);
    }

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Jonathan")
        .inner_size(800.0, 600.0)
        .min_inner_size(420.0, 280.0)
        .resizable(true)
        .visible(false)
        .additional_browser_args(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-pinch",
        );

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay);
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        builder = builder.decorations(false).shadow(false).transparent(true);
    }

    let window = builder.build()?;

    // With the "unstable" cargo feature (required for multi-webview panes),
    // tauri-runtime-wry creates each window's primary webview as
    // WebviewKind::WindowChild instead of WindowContent, and its
    // undecorated-resize border hit-test (TAURI_DRAG_RESIZE_WINDOW) is only
    // auto-attached at creation for WindowContent. Toggling set_resizable
    // independently triggers that same attach as a side effect, regardless
    // of webview kind.
    #[cfg(windows)]
    let _ = window.set_resizable(true);

    {
        let handle = app.clone();
        let label = label.to_string();
        window.on_window_event(move |event| {
            if let WindowEvent::Focused(true) = event {
                handle.state::<WindowRegistry>().set_focused(&label);
            }
            if matches!(event, WindowEvent::Destroyed) {
                handle.state::<WindowRegistry>().unregister(&label);
                let reaped_pty = handle.state::<pty::PtyState>().close_all_for_window(&label);
                if reaped_pty > 0 {
                    log::info!("window {label} closed: reaped {reaped_pty} pty session(s)");
                }
                let reaped_shell = handle.state::<shell::ShellState>().close_all_for_window(&label);
                if reaped_shell > 0 {
                    log::info!(
                        "window {label} closed: reaped {reaped_shell} shell session/bg proc(s)"
                    );
                }
                workspace::clear_launch_cwd(&label);
            }
            // macOS skips parent() for the settings window (see
            // open_settings_window), so tie its lifecycle to whichever
            // project window closes here instead. Other platforms use
            // parent() directly.
            #[cfg(target_os = "macos")]
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                if let Some(settings) = handle.get_webview_window("settings") {
                    let _ = settings.close();
                }
            }
        });
    }

    Ok(window)
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("terax:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the last-focused project window (not a hardcoded
    // "main" — a single-instance process can host more than one project
    // window) so settings minimizes/closes with whichever project is active.
    // macOS: skip parent() — child + always_on_top leaves the settings webview
    // behind the main window except while the parent is being dragged (#33).
    #[cfg(not(target_os = "macos"))]
    let builder = {
        let label = app.state::<WindowRegistry>().focused_or_main();
        if let Some(owner) = app.get_webview_window(&label) {
            builder.parent(&owner).map_err(|e| e.to_string())?
        } else {
            builder
        }
    };

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "macos")]
    if let Some(main) = {
        let label = app.state::<WindowRegistry>().focused_or_main();
        app.get_webview_window(&label)
    } {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_dir = parse_launch_dir();

    tauri::Builder::default()
        // Must be the very first plugin registered (its own requirement --
        // it sets up a named mutex/pipe very early, especially on Windows)
        // so opening a 2nd project folder routes into this process as a new
        // window instead of spawning a whole new Jonathan.exe -- which is
        // what made the bring-forward hotkey unreliable to begin with: two
        // processes both trying to own the same OS-level hotkey.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let win_registry = app.state::<WindowRegistry>();
            let dir = parse_launch_dir_from(argv.into_iter().skip(1));

            if let Some(existing_label) = dir.as_deref().and_then(|d| win_registry.label_for_dir(d)) {
                #[cfg(windows)]
                modules::win32_focus::bring_window_forward(app, &existing_label);
                #[cfg(not(windows))]
                if let Some(win) = app.get_webview_window(&existing_label) {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                return;
            }

            match dir {
                Some(dir) => {
                    let label = win_registry.next_label();
                    if let Err(e) = create_project_window(app, &label, Some(dir)) {
                        log::warn!("single-instance: failed to open project window: {e:?}");
                    }
                }
                None => {
                    let label = win_registry.focused_or_main();
                    #[cfg(windows)]
                    modules::win32_focus::bring_window_forward(app, &label);
                    #[cfg(not(windows))]
                    if let Some(win) = app.get_webview_window(&label) {
                        let _ = win.unminimize();
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // DECORATIONS excluded alongside VISIBLE: it must always come from
                // tauri.conf.json, not a stale saved session — otherwise a config
                // change (e.g. decorations:false) gets silently overwritten by the
                // last-saved value on every launch.
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                // Default targets are Stdout + LogDir only; add Webview so
                // Rust-side log::info!/warn! (e.g. toast activation) shows up
                // in devtools console alongside the JS-side logging, instead
                // of only in the log file.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Webview,
                ))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::default())
        .manage(preview::PreviewState::default())
        .manage(preview::PreviewKeys::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage(mirror::MirrorState::default())
        .manage(snippet::SnippetState::default())
        .manage(workspace::WorkspaceRegistry::default())
        .manage(LaunchDir::default())
        .manage(WindowRegistry::default())
        .setup(move |_app| {
            // Created here (imperative Rust) instead of tauri.conf.json's
            // declarative "windows" array, matching the settings/snippet
            // pattern. (The real root cause of the resize/taskbar bug turned
            // out to be stale "fullscreen": true window-state restoration,
            // not the creation path -- see StateFlags::FULLSCREEN exclusion
            // above -- but this imperative form is kept since it mirrors the
            // rest of the window-creation code in this file.) Shared with the
            // single-instance plugin's 2nd-launch path -- see
            // create_project_window.
            create_project_window(_app.handle(), "main", cli_dir)?;

            // Expire staged downloads left over from previous sessions, then
            // keep sweeping hourly for as long as the app runs. Runs once for
            // the whole process (not per project window) now that a
            // single-instance process can host more than one.
            modules::download::spawn_sweeper(_app.handle().clone());

            // Backup path to bring Jonathan forward when toast-click
            // activation silently fails to fire (observed: no callback at
            // all, unrelated to the app that was focused -- see
            // win32_focus.rs for the click path this bypasses entirely).
            // Targets the last-focused project window, not a hardcoded
            // "main" -- a single-instance process can host more than one.
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                let handle = _app.handle().clone();
                if let Err(e) = _app
                    .global_shortcut()
                    .on_shortcut("ctrl+alt+shift+j", move |_app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let label = handle.state::<WindowRegistry>().focused_or_main();
                            #[cfg(windows)]
                            modules::win32_focus::bring_window_forward(&handle, &label);
                            #[cfg(not(windows))]
                            if let Some(win) = handle.get_webview_window(&label) {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    })
                {
                    log::warn!("failed to register bring-forward global shortcut: {e:?}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_shell_name,
            pty::pty_list_shells,
            preview::preview_open,
            preview::preview_navigate,
            preview::preview_back,
            preview::preview_forward,
            preview::preview_set_bounds,
            preview::preview_show,
            preview::preview_hide,
            preview::preview_close,
            preview::preview_set_key_combos,
            preview_capture::preview_capture,
            preview_capture::preview_raise,
            archive::archive_extract,
            archive::archive_add,
            download::download_save_as,
            download::download_save_to_dir,
            download::download_discard,
            download::download_sweep,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_copy,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            open_settings_window,
            snippet::open_snippet_window,
            snippet::take_snippet_data,
            snippet::save_snippet_png,
            agent::agent_enable_claude_hooks,
            agent::agent_claude_hooks_status,
            toast::show_native_toast,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            mirror::mirror_adb_devices,
            mirror::mirror_adb_connect,
            mirror::mirror_adb_disconnect,
            mirror::mirror_start,
            mirror::mirror_stop,
            tailscale::tailscale_status,
            tailscale::tailscale_up,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
