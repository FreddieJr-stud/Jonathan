use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Crop payloads keyed by window label. The image never travels through the
/// window URL (data URLs blow past URL length limits); the snippet window
/// pulls its own payload once it has booted.
#[derive(Default)]
pub struct SnippetState(Mutex<HashMap<String, String>>);

#[tauri::command]
pub async fn open_snippet_window(
    app: tauri::AppHandle,
    state: State<'_, SnippetState>,
    label: String,
    data_url: String,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    if !label.starts_with("snippet-") {
        return Err("snippet labels must start with 'snippet-'".into());
    }
    if app.get_webview_window(&label).is_some() {
        return Err(format!("window {label} already exists"));
    }

    state
        .0
        .lock()
        .map_err(|_| "snippet store poisoned".to_string())?
        .insert(label.clone(), data_url);

    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("snippet.html".into()))
            .title("Snippet")
            .inner_size(width, height)
            .min_inner_size(40.0, 40.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(true)
            // Shown by the frontend once the crop is painted, so the window
            // never flashes empty over whatever is underneath it.
            .visible(false);

    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }

    builder.build().map_err(|e| {
        // Don't leak the payload if the window failed to come up.
        if let Ok(mut map) = state.0.lock() {
            map.remove(&label);
        }
        e.to_string()
    })?;

    Ok(())
}

/// Hands the crop to the snippet window and drops it from the store, so a
/// reload can't resurrect a snippet the user already closed.
#[tauri::command]
pub fn take_snippet_data(state: State<'_, SnippetState>, label: String) -> Option<String> {
    state.0.lock().ok()?.remove(&label)
}

#[tauri::command]
pub fn save_snippet_png(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}
