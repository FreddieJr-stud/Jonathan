//! Extract/compress commands backed by a bundled `7z.exe` + `7z.dll` (the
//! real 7-Zip console binary), shelled out to directly rather than
//! reimplemented — gives full format parity with real 7-Zip. `7z.dll` must
//! sit alongside `7z.exe` in the resources dir; the OS loader picks it up
//! from the executable's own directory.

use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager};

use super::proc::hide_console;
use super::workspace::{resolve_path, WorkspaceEnv};

fn resolve_7z(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/7z.exe", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("7z.exe not found: {e}"))
}

fn run_7z(app: &AppHandle, args: &[String]) -> Result<(), String> {
    let bin = resolve_7z(app)?;
    let mut cmd = Command::new(&bin);
    cmd.args(args);
    hide_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run 7z: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!("7z failed ({:?}): {msg}", args);
        Err(if msg.is_empty() {
            "7z exited with an error".to_string()
        } else {
            msg
        })
    }
}

/// Extracts `archive_path` into `dest_dir`, creating it if needed. Overwrites
/// existing entries at the destination (`-y`), matching 7-Zip's own
/// "Extract Here" / "Extract to <name>\" behavior.
#[tauri::command]
pub fn archive_extract(
    app: AppHandle,
    archive_path: String,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let archive = resolve_path(&archive_path, &workspace);
    let dest = resolve_path(&dest_dir, &workspace);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    run_7z(
        &app,
        &[
            "x".to_string(),
            archive.display().to_string(),
            format!("-o{}", dest.display()),
            "-y".to_string(),
        ],
    )
}

/// Compresses `sources` into `dest_archive`. Refuses to overwrite an existing
/// archive at the destination.
#[tauri::command]
pub fn archive_add(
    app: AppHandle,
    sources: Vec<String>,
    dest_archive: String,
    format: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Err("no sources selected".to_string());
    }
    let type_flag = match format.as_str() {
        "zip" => "-tzip",
        "7z" => "-t7z",
        other => return Err(format!("unsupported archive format: {other}")),
    };
    let workspace = WorkspaceEnv::from_option(workspace);
    let dest = resolve_path(&dest_archive, &workspace);
    if dest.exists() {
        return Err(format!("already exists: {}", dest.display()));
    }
    let mut args = vec![
        "a".to_string(),
        type_flag.to_string(),
        dest.display().to_string(),
    ];
    for source in &sources {
        args.push(resolve_path(source, &workspace).display().to_string());
    }
    run_7z(&app, &args)
}
