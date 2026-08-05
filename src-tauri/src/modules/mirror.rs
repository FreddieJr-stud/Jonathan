//! Android device mirroring via adb + scrcpy-server.
//!
//! The frontend speaks the scrcpy protocol (@yume-chan/scrcpy); this module
//! only provides the plumbing a webview cannot do itself:
//! - running adb (devices / connect / push / forward / app_process)
//! - a localhost WebSocket<->TCP proxy so the webview can reach the
//!   adb-forwarded scrcpy sockets.
//!
//! Each WebSocket connection accepted by the proxy opens a fresh TCP
//! connection to the forwarded port. scrcpy assigns socket roles by connect
//! order (video first, then control), so the frontend must open the video
//! socket before the control socket.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri::async_runtime::JoinHandle;
use tokio::net::{TcpListener, TcpStream};

use super::proc::hide_console;

const SERVER_JAR: &str = "scrcpy-server-v3.3.3.jar";
const DEVICE_JAR_PATH: &str = "/data/local/tmp/terax-scrcpy-server.jar";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MirrorSessionInfo {
    pub scid: String,
    pub ws_port: u16,
}

struct Session {
    server_child: Child,
    forward_port: u16,
    serial: String,
    listener_task: JoinHandle<()>,
}

#[derive(Default)]
pub struct MirrorState {
    sessions: Mutex<HashMap<String, Session>>,
}

fn adb_path() -> String {
    if let Ok(p) = std::env::var("TERAX_ADB") {
        if !p.is_empty() {
            return p;
        }
    }
    let exe = if cfg!(windows) { "adb.exe" } else { "adb" };
    for base in [
        std::env::var("ANDROID_HOME").ok(),
        std::env::var("ANDROID_SDK_ROOT").ok(),
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|l| format!("{l}\\Android\\Sdk")),
    ]
    .into_iter()
    .flatten()
    {
        let candidate = std::path::Path::new(&base).join("platform-tools").join(exe);
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    "adb".to_string()
}

fn adb_cmd(args: &[&str]) -> Command {
    let mut cmd = Command::new(adb_path());
    cmd.args(args);
    hide_console(&mut cmd);
    cmd
}

fn run_adb(args: &[&str]) -> Result<String, String> {
    let out = adb_cmd(args)
        .output()
        .map_err(|e| format!("failed to run adb: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(format!(
            "adb {} failed: {}{}",
            args.join(" "),
            stdout.trim(),
            stderr.trim()
        ))
    }
}

#[tauri::command]
pub fn mirror_adb_devices() -> Result<Vec<AdbDevice>, String> {
    let out = run_adb(&["devices", "-l"])?;
    let mut devices = Vec::new();
    for line in out.lines().skip(1) {
        let mut parts = line.split_whitespace();
        let (Some(serial), Some(state)) = (parts.next(), parts.next()) else {
            continue;
        };
        let model = parts
            .find_map(|p| p.strip_prefix("model:"))
            .map(|m| m.replace('_', " "));
        devices.push(AdbDevice {
            serial: serial.to_string(),
            state: state.to_string(),
            model,
        });
    }
    Ok(devices)
}

#[tauri::command]
pub fn mirror_adb_connect(endpoint: String) -> Result<String, String> {
    let out = run_adb(&["connect", &endpoint])?;
    let trimmed = out.trim().to_string();
    // `adb connect` reports failure on stdout with exit code 0.
    if trimmed.contains("cannot connect") || trimmed.contains("failed to connect") {
        Err(trimmed)
    } else {
        Ok(trimmed)
    }
}

#[tauri::command]
pub fn mirror_adb_disconnect(endpoint: String) -> Result<String, String> {
    run_adb(&["disconnect", &endpoint]).map(|s| s.trim().to_string())
}

fn resolve_server_jar(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve(format!("resources/{SERVER_JAR}"), tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("scrcpy server binary not found: {e}"))
}

async fn pump_ws_tcp(ws: tokio_tungstenite::WebSocketStream<TcpStream>, tcp: TcpStream) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let (mut ws_tx, mut ws_rx) = ws.split();
    let (mut tcp_rx, mut tcp_tx) = tcp.into_split();

    let to_ws = async {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match tcp_rx.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if ws_tx.send(Message::Binary(buf[..n].to_vec().into())).await.is_err() {
                        break;
                    }
                }
            }
        }
        let _ = ws_tx.close().await;
    };
    let to_tcp = async {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Binary(data) => {
                    if tcp_tx.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        let _ = tcp_tx.shutdown().await;
    };
    tokio::join!(to_ws, to_tcp);
}

#[tauri::command]
pub fn mirror_start(
    app: AppHandle,
    state: State<'_, MirrorState>,
    serial: String,
    scid: String,
    server_version: String,
    server_args: Vec<String>,
) -> Result<MirrorSessionInfo, String> {
    let jar = resolve_server_jar(&app)?;
    run_adb(&[
        "-s",
        &serial,
        "push",
        &jar.to_string_lossy(),
        DEVICE_JAR_PATH,
    ])?;

    // tcp:0 lets adb pick a free port; it prints the chosen port on stdout.
    let socket_name = format!("localabstract:scrcpy_{scid}");
    let forward_out = run_adb(&["-s", &serial, "forward", "tcp:0", &socket_name])?;
    let forward_port: u16 = forward_out
        .trim()
        .parse()
        .map_err(|_| format!("unexpected adb forward output: {forward_out}"))?;

    let cleanup_forward = |port: u16| {
        let _ = run_adb(&["-s", &serial, "forward", "--remove", &format!("tcp:{port}")]);
    };

    let shell_cmd = format!(
        "CLASSPATH={DEVICE_JAR_PATH} app_process / com.genymobile.scrcpy.Server {server_version} {}",
        server_args.join(" ")
    );
    let mut child = match adb_cmd(&["-s", &serial, "shell", &shell_cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            cleanup_forward(forward_port);
            return Err(format!("failed to start scrcpy server: {e}"));
        }
    };

    // Surface server output to the frontend for connection state + debugging.
    for (stream, is_err) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), false),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), true),
    ] {
        let Some(stream) = stream else { continue };
        let app = app.clone();
        let scid = scid.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let _ = app.emit(
                    "mirror://server-log",
                    serde_json::json!({ "scid": scid, "line": line, "stderr": is_err }),
                );
            }
        });
    }

    // WebSocket proxy: bind before returning so the port is ready.
    let std_listener = match std::net::TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(e) => {
            let _ = child.kill();
            cleanup_forward(forward_port);
            return Err(format!("failed to bind proxy port: {e}"));
        }
    };
    std_listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let ws_port = std_listener.local_addr().map_err(|e| e.to_string())?.port();

    let listener_task = tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(std_listener) else {
            return;
        };
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let _ = stream.set_nodelay(true);
            tauri::async_runtime::spawn(async move {
                let Ok(ws) = tokio_tungstenite::accept_async(stream).await else {
                    return;
                };
                let Ok(tcp) = TcpStream::connect(("127.0.0.1", forward_port)).await else {
                    return;
                };
                let _ = tcp.set_nodelay(true);
                pump_ws_tcp(ws, tcp).await;
            });
        }
    });

    let info = MirrorSessionInfo {
        scid: scid.clone(),
        ws_port,
    };
    state.sessions.lock().unwrap().insert(
        scid,
        Session {
            server_child: child,
            forward_port,
            serial,
            listener_task,
        },
    );
    Ok(info)
}

#[tauri::command]
pub fn mirror_stop(state: State<'_, MirrorState>, scid: String) -> Result<(), String> {
    let Some(mut session) = state.sessions.lock().unwrap().remove(&scid) else {
        return Ok(());
    };
    session.listener_task.abort();
    let _ = session.server_child.kill();
    let _ = run_adb(&[
        "-s",
        &session.serial,
        "forward",
        "--remove",
        &format!("tcp:{}", session.forward_port),
    ]);
    Ok(())
}
