//! Tailscale daemon status/start, used to auto-start the tailnet before the
//! dashboard-client tab tries to reach the phone's tailnet IP.

use std::process::Command;

use serde::Deserialize;

use super::proc::hide_console;

fn tailscale_cmd(args: &[&str]) -> Command {
    let mut cmd = Command::new("tailscale");
    cmd.args(args);
    hide_console(&mut cmd);
    cmd
}

fn run_tailscale(args: &[&str]) -> Result<String, String> {
    let out = tailscale_cmd(args)
        .output()
        .map_err(|e| format!("failed to run tailscale: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(format!(
            "tailscale {} failed: {}{}",
            args.join(" "),
            stdout.trim(),
            stderr.trim()
        ))
    }
}

#[derive(Deserialize)]
struct TailscaleStatus {
    #[serde(rename = "BackendState")]
    backend_state: String,
}

#[tauri::command]
pub async fn tailscale_status() -> Result<String, String> {
    let out = tokio::task::spawn_blocking(|| run_tailscale(&["status", "--json"]))
        .await
        .map_err(|e| format!("tailscale task panicked: {e}"))??;
    let status: TailscaleStatus = serde_json::from_str(&out)
        .map_err(|e| format!("failed to parse tailscale status: {e}"))?;
    Ok(status.backend_state)
}

#[tauri::command]
pub async fn tailscale_up() -> Result<(), String> {
    let result = tokio::task::spawn_blocking(|| run_tailscale(&["up"]))
        .await
        .map_err(|e| format!("tailscale task panicked: {e}"))?;
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if e.contains("NeedsLogin") || e.to_lowercase().contains("login") {
                Err("Tailscale isn't authenticated — run `tailscale login` manually.".to_string())
            } else {
                Err(e)
            }
        }
    }
}
