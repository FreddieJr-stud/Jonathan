// Toast-click activation grants a one-shot exemption from Windows'
// foreground-lock heuristic, but that grant can be silently invalidated by
// an intermediate foreground-change event before we get to call
// `SetForegroundWindow` -- more likely with multi-process apps (a browser's
// broker/content/GPU processes) than a single-process game, which is why
// clicking the toast can reliably fail for one app and not another.
// `AttachThreadInput` sidesteps the lock entirely instead of depending on
// that grant still being valid by the time we act on it.

use tauri::Manager;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    FLASHW_TIMERNOFG, FLASHW_TRAY, FLASHWINFO, FlashWindowEx, GetForegroundWindow,
    GetWindowThreadProcessId, SetForegroundWindow,
};

/// Unminimizes/shows the window `label` and forces it to the foreground,
/// logging the outcome. Shared by the toast-activation path (toast.rs) and
/// the global-hotkey fallback (lib.rs) that exists because toast activation
/// can silently fail to fire at all -- see the comment on that hotkey.
/// Takes a label (not hardcoded "main") because a single-instance process can
/// now host multiple project windows; callers resolve the target via
/// `WindowRegistry::focused_or_main()`.
pub fn bring_window_forward(app: &tauri::AppHandle, label: &str) {
    match app.get_webview_window(label) {
        Some(win) => {
            let _ = win.unminimize();
            let _ = win.show();
            match win.hwnd() {
                Ok(hwnd) => {
                    let ok = force_foreground(hwnd);
                    log::info!("force_foreground succeeded: {ok} (window={label})");
                }
                Err(e) => log::warn!("{label}.hwnd() failed: {e:?}"),
            }
        }
        None => log::warn!("bring_window_forward: no window found for label={label}"),
    }
}

/// Forces `hwnd` to the foreground, bypassing Windows' foreground-lock
/// restriction via `AttachThreadInput`. Falls back to flashing the taskbar
/// icon if the foreground steal itself fails. Returns `true` if
/// `SetForegroundWindow` succeeded.
pub fn force_foreground(hwnd: HWND) -> bool {
    if hwnd.0.is_null() {
        return false;
    }

    let current_thread = unsafe { GetCurrentThreadId() };
    let fg = unsafe { GetForegroundWindow() };
    let target_thread = if fg.0.is_null() {
        0
    } else {
        unsafe { GetWindowThreadProcessId(fg, None) }
    };

    let attached = target_thread != 0
        && target_thread != current_thread
        && unsafe { AttachThreadInput(current_thread, target_thread, true) }.as_bool();

    let result = unsafe { SetForegroundWindow(hwnd) }.as_bool();

    if attached {
        let _ = unsafe { AttachThreadInput(current_thread, target_thread, false) };
    }

    if result {
        return true;
    }

    let info = FLASHWINFO {
        cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
        hwnd,
        dwFlags: FLASHW_TRAY | FLASHW_TIMERNOFG,
        uCount: 3,
        dwTimeout: 0,
    };
    let _ = unsafe { FlashWindowEx(&info) };
    false
}
