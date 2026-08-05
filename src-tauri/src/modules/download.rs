//! Downloads started inside a preview webview.
//!
//! WebView2 otherwise drops files into the OS Downloads folder with no prompt.
//! Instead every download is redirected into a per-app staging directory and the
//! frontend is told when it lands, so the user can preview it, save it somewhere
//! deliberate, or ignore it — in which case it is swept after `TTL`.
//!
//! Why stage rather than prompt first: `DownloadEvent::Requested` is synchronous
//! and runs on the WebView2 UI thread. It must return a destination immediately,
//! so it cannot await a dialog. Cancelling and re-fetching ourselves was the
//! other option, but the download's session cookies live in the webview profile
//! — an authenticated download would silently save a login page instead of the
//! file. Staging keeps the real bytes and moves the choice to `Finished`.
//!
//! Every path-taking command re-checks that its argument is inside the staging
//! root: these are reachable from the frontend, and must never become a
//! "delete/move any file on disk" primitive.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Staged files are deleted this long after they land.
const TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Disambiguates two downloads landing in the same millisecond.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// A finished download, handed to the frontend so it can prompt.
#[derive(Clone, Serialize)]
pub struct DownloadEventPayload {
    pub url: String,
    /// Absolute path inside the staging root. Empty when `success` is false.
    pub path: String,
    /// File name for display.
    pub name: String,
    pub size: u64,
    pub success: bool,
}

/// Root of the staging area: `<app local data>/downloads-staging`.
pub fn staging_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads-staging");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Whether `path` really lives inside the staging root. Both sides are
/// canonicalized so `..` traversal and symlinks can't smuggle a path out.
fn is_staged(app: &AppHandle, path: &Path) -> bool {
    let Ok(root) = staging_root(app) else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    // The file may already be gone (double-click on Delete); fall back to the
    // parent so a stale path still resolves to a yes/no rather than a panic.
    let resolved = path
        .canonicalize()
        .or_else(|_| path.parent().unwrap_or(path).canonicalize());
    matches!(resolved, Ok(p) if p.starts_with(&root))
}

/// Redirects a starting download into its own staging subdirectory.
///
/// Returns `true` (allow the download) in every case: if staging can't be
/// prepared, the untouched default destination is better than a download the
/// user asked for silently failing.
pub fn on_requested(app: &AppHandle, destination: &mut PathBuf) -> bool {
    let name = destination
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "download".to_string());
    let Ok(root) = staging_root(app) else {
        return true;
    };
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    // One subdirectory per download, so same-named files never collide and the
    // sweep can drop a whole download with one `remove_dir_all`.
    let dir = root.join(format!("{stamp}-{seq}"));
    if std::fs::create_dir_all(&dir).is_err() {
        return true;
    }
    // `file_name` above already stripped any directory component, so the page
    // cannot steer the write outside `dir` via a crafted name.
    *destination = dir.join(name);
    true
}

/// Announces a finished download to the frontend, which owns the prompt.
pub fn on_finished(app: &AppHandle, url: String, path: Option<PathBuf>, success: bool) {
    let path = path.filter(|_| success);
    let size = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .unwrap_or(0);
    let name = path
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let _ = app.emit(
        "terax:download-finished",
        DownloadEventPayload {
            url,
            path: path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            name,
            size,
            success,
        },
    );
}

/// Moves a staged file to `dest`, promoting it out of the TTL sweep's reach.
/// Falls back to copy+remove when the destination is on another volume.
#[tauri::command]
pub async fn download_save_as(app: AppHandle, path: String, dest: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !is_staged(&app, &src) {
        return Err("refusing to move a file outside the download staging area".into());
    }
    let dest = PathBuf::from(&dest);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if std::fs::rename(&src, &dest).is_err() {
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&src);
    }
    // The now-empty staging subdirectory would otherwise linger until the sweep.
    if let Some(dir) = src.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}

/// Moves a staged file into `dir`, keeping its own name. Never overwrites: a
/// clashing name gains a ` (n)` suffix, the way a browser's download folder
/// does. Returns the path actually written.
#[tauri::command]
pub async fn download_save_to_dir(
    app: AppHandle,
    path: String,
    dir: String,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !is_staged(&app, &src) {
        return Err("refusing to move a file outside the download staging area".into());
    }
    let dir = PathBuf::from(&dir);
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let dest = unique_dest(&dir, &name);
    if std::fs::rename(&src, &dest).is_err() {
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&src);
    }
    if let Some(staged_dir) = src.parent() {
        let _ = std::fs::remove_dir(staged_dir);
    }
    Ok(dest.to_string_lossy().to_string())
}

/// First free path for `name` in `dir`: `x.pdf`, then `x (1).pdf`, `x (2).pdf`…
fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    // Split on the LAST dot so `archive.tar.gz` keeps `.gz` and stems the rest —
    // matching `Path::file_stem`/`extension` rather than inventing new rules.
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..10_000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    first
}

/// Deletes a staged download now, instead of waiting for the sweep.
#[tauri::command]
pub async fn download_discard(app: AppHandle, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !is_staged(&app, &src) {
        return Err("refusing to delete a file outside the download staging area".into());
    }
    let _ = std::fs::remove_file(&src);
    if let Some(dir) = src.parent() {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}

/// Deletes staged downloads older than [`TTL`]. Returns how many were removed.
#[tauri::command]
pub async fn download_sweep(app: AppHandle) -> Result<u32, String> {
    Ok(sweep(&app))
}

/// Sweep implementation shared by the command and the startup/hourly thread.
pub fn sweep(app: &AppHandle) -> u32 {
    let Ok(root) = staging_root(app) else {
        return 0;
    };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return 0;
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        // Age is taken from the newest mtime in the subdirectory: the directory's
        // own mtime does not move as the file is written on every platform.
        let modified = newest_mtime(&path).unwrap_or(now);
        if now
            .duration_since(modified)
            .map(|age| age >= TTL)
            .unwrap_or(false)
        {
            let ok = if path.is_dir() {
                std::fs::remove_dir_all(&path).is_ok()
            } else {
                std::fs::remove_file(&path).is_ok()
            };
            if ok {
                removed += 1;
            }
        }
    }
    removed
}

fn newest_mtime(path: &Path) -> Option<SystemTime> {
    let meta = std::fs::metadata(path).ok()?;
    let mut newest = meta.modified().ok()?;
    if meta.is_dir() {
        for entry in std::fs::read_dir(path).ok()?.flatten() {
            if let Ok(m) = entry.metadata().and_then(|m| m.modified()) {
                if m > newest {
                    newest = m;
                }
            }
        }
    }
    Some(newest)
}

/// Sweeps once at startup, then hourly. A background thread rather than a
/// frontend timer so an app left running for days still expires its staging
/// area, and a crash before the next tick costs at most one hour of delay.
pub fn spawn_sweeper(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            let removed = sweep(&app);
            if removed > 0 {
                log::info!("download sweep removed {removed} expired staged download(s)");
            }
            std::thread::sleep(Duration::from_secs(60 * 60));
        }
    });
}
