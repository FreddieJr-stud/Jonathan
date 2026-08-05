// tauri-plugin-notification's Windows backend (notify-rust) doesn't wire
// click activation back into the app, so clicking a toast while Jonathan is
// unfocused does nothing. winrt-toast talks to the same OS toast platform
// directly and registers a real `Activated` handler: the notification
// platform holds its own reference to the toast object once shown, so the
// handler keeps firing (even much later, from Action Center) without us
// needing to block a thread to keep anything alive.
#[cfg(windows)]
mod imp {
    use tauri::{AppHandle, Emitter, Manager};
    use winrt_toast::{Text, Toast, ToastManager};

    // Must match `identifier` in tauri.conf.json -- that's the AUMID the
    // installer registers via the Start Menu shortcut.
    const AUMID: &str = "app.crynta.terax";
    pub const ACTIVATED_EVENT: &str = "terax:toast-activated";

    pub fn show(app: AppHandle, title: String, body: String, launch_arg: String) {
        // show_with_callbacks registers the handler then returns; run it off
        // the async command thread purely to keep any COM apartment setup
        // it does away from Tauri's own threads.
        std::thread::spawn(move || {
            let manager = ToastManager::new(AUMID);
            let mut toast = Toast::new();
            toast.text1(title).text2(Text::new(body)).launch(launch_arg);

            let result = manager.show_with_callbacks(
                &toast,
                Some(Box::new(move |res| {
                    log::info!("native toast activated: {res:?}");
                    if let Ok(arg) = res {
                        // Clicking a toast does not foreground a hidden or
                        // minimized window on Windows, so the in-app nav that
                        // ACTIVATED_EVENT triggers would happen invisibly.
                        // Bring the target window forward first. set_focus()
                        // alone relies on a one-shot foreground-lock exemption
                        // that toast activation grants us, which can get
                        // silently invalidated by an intermediate foreground
                        // change before we act on it -- more likely with
                        // multi-process apps (browsers) than a single-process
                        // game. force_foreground() bypasses the lock directly.
                        // Targets the last-focused project window, not a
                        // hardcoded "main" -- a single-instance process can
                        // host more than one project window.
                        let label = app.state::<crate::WindowRegistry>().focused_or_main();
                        crate::modules::win32_focus::bring_window_forward(&app, &label);
                        let _ = app.emit(ACTIVATED_EVENT, arg);
                    }
                })),
                None,
                None,
            );
            if let Err(e) = result {
                log::warn!("native toast show failed: {e:?}");
            }
        });
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn show_native_toast(app: tauri::AppHandle, title: String, body: String, launch_arg: String) {
    imp::show(app, title, body, launch_arg);
}

#[cfg(not(windows))]
#[tauri::command]
pub fn show_native_toast(
    _app: tauri::AppHandle,
    _title: String,
    _body: String,
    _launch_arg: String,
) {
}
