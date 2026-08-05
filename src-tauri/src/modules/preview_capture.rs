//! Windows-only native capture of a single preview webview's current frame,
//! used by Preview Snip (`PreviewSnip.tsx`).
//!
//! Uses WebView2's own `ICoreWebView2::CapturePreview`, which asks the
//! browser engine directly for an encoded frame — independent of Win32/DWM
//! window composition. That matters specifically for tabs that are
//! `webview.hide()`d (a real `ShowWindow(SW_HIDE)`, not just occluded): an
//! earlier version of this used `PrintWindow(hdc, PW_RENDERFULLCONTENT)`
//! against the webview's own child HWND, which reads stale/black/wrong
//! content once a WebView2-backed window is genuinely hidden rather than
//! merely covered by another window — Chromium stops producing frames for
//! it, and PrintWindow's forced-render flag doesn't reliably survive that.
//! `CapturePreview` doesn't go through DWM at all, so hidden vs. frontmost is
//! a non-issue.

use tauri::AppHandle;

#[tauri::command]
pub async fn preview_capture(app: AppHandle, label: String) -> Result<String, String> {
    capture_data_url(app, label).await
}

#[cfg(windows)]
async fn capture_data_url(app: AppHandle, label: String) -> Result<String, String> {
    use base64::Engine;
    use tauri::Manager;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("no preview webview for label {label:?}"))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    // `start_capture` only *initiates* CapturePreview and returns — it must
    // not block waiting for the completion. This closure runs dispatched onto
    // the WebView2 UI thread; pumping a nested wait loop from inside that
    // thread's own message dispatch is exactly the kind of reentrancy that
    // crashes WebView2 (confirmed: an earlier version of this used
    // `wait_for_async_operation`, a blocking pump, right here, and took the
    // whole app down silently — no panic, just gone). The completion handler
    // registered inside `start_capture` fires later through the app's own
    // already-running event loop, so nothing here needs to wait for it.
    webview
        .with_webview(move |pw| win::start_capture(pw, tx))
        .map_err(|e| e.to_string())?;
    let png = rx
        .await
        .map_err(|_| "capture task was dropped before completing".to_string())??;

    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[cfg(not(windows))]
async fn capture_data_url(_app: AppHandle, _label: String) -> Result<String, String> {
    Err("preview_capture is only implemented on Windows".to_string())
}

/// Raises a `preview-*` or mini-panel webview's native child HWND to the top
/// of its parent's Win32 z-order.
///
/// All of Preview's tab webviews and the Music/Messenger/Gmail mini panels are
/// sibling `add_child` HWNDs stacked over the *same* screen rect (the mini
/// panels float over the top-right corner of the Preview area by design).
/// Win32 puts a newly created or re-shown child on top of its siblings by
/// default, so whichever webview happened to be created or shown *last* wins
/// the paint order — nondeterministic from the user's perspective. Callers
/// invoke this after `preview_show`/`add_child` to make the stacking
/// intentional instead of incidental.
#[tauri::command]
pub async fn preview_raise(app: AppHandle, label: String) -> Result<(), String> {
    raise_to_top(app, label).await
}

#[cfg(windows)]
async fn raise_to_top(app: AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("no preview webview for label {label:?}"))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    webview
        .with_webview(move |pw| {
            let _ = tx.send(win::raise_to_top(pw));
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "raise task was dropped before completing".to_string())?
}

#[cfg(not(windows))]
async fn raise_to_top(_app: AppHandle, _label: String) -> Result<(), String> {
    Ok(())
}

/// Disables WebView2's built-in "browser accelerator keys" on a preview
/// webview, so keys like Ctrl+D never reach the page at all.
///
/// `AreBrowserAcceleratorKeysEnabled` defaults to true (WebView2's own
/// default): WebView2 reserves a fixed set of Ctrl/F-key combos for browser
/// chrome it doesn't even expose here (bookmark, find, print, ...) and
/// swallows them before dispatching a `keydown` to the DOM. That happens
/// *above* page JS, so it silently defeats both `KEY_FORWARD_JS` (the host
/// shortcut never fires) and the previewed page's own handler for the same
/// key (e.g. Canva's own Ctrl+D duplicate) — neither ever sees the event.
/// Disabling it hands every key back to the DOM, where `KEY_FORWARD_JS`
/// forwards what the host has bound and lets everything else fall through to
/// the page as normal. Called once right after `add_child` creates the
/// webview (see `preview_open` in `preview.rs`) — not a command, since
/// nothing on the frontend needs to trigger it directly.
#[cfg(windows)]
pub async fn disable_accelerator_keys(app: AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("no preview webview for label {label:?}"))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    webview
        .with_webview(move |pw| {
            let _ = tx.send(win::disable_accelerator_keys(pw));
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "accelerator-key task was dropped before completing".to_string())?
}

#[cfg(not(windows))]
pub async fn disable_accelerator_keys(_app: AppHandle, _label: String) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
    };

    /// Kicks off `CapturePreview` and returns immediately — never call
    /// `wait_for_async_operation` (or anything else that blocks) from a
    /// `with_webview`-dispatched closure. That closure runs on the WebView2
    /// UI thread; a nested blocking message-pump wait started from inside
    /// that thread's own message dispatch is reentrant in a way that has
    /// crashed WebView2 outright here (silently — no panic, the process just
    /// disappeared). `tx` is resolved on every path: synchronously on early
    /// setup failure, or later from the completion handler once COM calls it
    /// back through the app's own already-running event loop.
    pub(super) fn start_capture(
        pw: tauri::webview::PlatformWebview,
        tx: tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>,
    ) {
        use webview2_com::CapturePreviewCompletedHandler;
        use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

        let setup = (|| unsafe {
            let controller = pw.controller();
            let webview = controller
                .CoreWebView2()
                .map_err(|e| format!("CoreWebView2: {e}"))?;
            // A growable, self-owned memory stream — CapturePreview writes the
            // already-encoded PNG straight into it, so there's no GDI buffer
            // or manual pixel handling on this side at all.
            let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)
                .map_err(|e| format!("CreateStreamOnHGlobal: {e}"))?;
            Ok::<_, String>((webview, stream))
        })();

        let (webview, stream) = match setup {
            Ok(pair) => pair,
            Err(e) => {
                let _ = tx.send(Err(e));
                return;
            }
        };

        let handler_stream = stream.clone();
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
            let _ = tx.send(read_capture_result(result, &handler_stream));
            Ok(())
        }));

        if let Err(e) = unsafe {
            webview.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
        } {
            // COM never accepted the handler, so it will not call it back —
            // `handler` (and the `tx` it holds) drop right here uncalled.
            // `rx.await` on the other end resolves via the dropped-sender
            // path ("capture task was dropped before completing"), not a hang.
            log::warn!("preview capture: CapturePreview failed to start: {e}");
        }
    }

    fn read_capture_result(
        result: windows::core::Result<()>,
        stream: &windows::Win32::System::Com::IStream,
    ) -> Result<Vec<u8>, String> {
        use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
        unsafe {
            result.map_err(|e| format!("CapturePreview failed: {e}"))?;
            stream
                .Seek(0, STREAM_SEEK_SET, None)
                .map_err(|e| format!("stream seek: {e}"))?;
            let mut stat = STATSTG::default();
            stream
                .Stat(&mut stat, STATFLAG_NONAME)
                .map_err(|e| format!("stream stat: {e}"))?;
            let len = stat.cbSize as usize;
            let mut png = vec![0u8; len];
            let mut read = 0u32;
            stream
                .Read(png.as_mut_ptr() as *mut _, len as u32, Some(&mut read))
                .ok()
                .map_err(|e| format!("stream read: {e}"))?;
            png.truncate(read as usize);
            Ok(png)
        }
    }

    pub(super) fn disable_accelerator_keys(
        pw: tauri::webview::PlatformWebview,
    ) -> Result<(), String> {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;

        unsafe {
            let controller = pw.controller();
            let webview = controller
                .CoreWebView2()
                .map_err(|e| format!("CoreWebView2: {e}"))?;
            let settings3 = webview
                .Settings()
                .map_err(|e| format!("Settings: {e}"))?
                .cast::<ICoreWebView2Settings3>()
                .map_err(|e| format!("cast ICoreWebView2Settings3: {e}"))?;
            settings3
                .SetAreBrowserAcceleratorKeysEnabled(false)
                .map_err(|e| format!("SetAreBrowserAcceleratorKeysEnabled: {e}"))
        }
    }

    pub(super) fn raise_to_top(pw: tauri::webview::PlatformWebview) -> Result<(), String> {
        unsafe {
            let controller = pw.controller();
            let mut hwnd = HWND::default();
            controller
                .ParentWindow(&mut hwnd)
                .map_err(|e| format!("ParentWindow: {e}"))?;
            if hwnd.is_invalid() {
                return Err("webview has no parent HWND".to_string());
            }
            SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .map_err(|e| format!("SetWindowPos: {e}"))
        }
    }
}
