use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Instant;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::types::{SidecarState, SidecarStatus};

const SIDECAR_PORT: u16 = 9876;
const SIDECAR_BASE_URL: &str = "http://127.0.0.1:9876";
const MAX_RESTART_ATTEMPTS: u32 = 3;
const HEALTH_CHECK_INTERVAL_SECS: u64 = 5;
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 2;
const STARTUP_TIMEOUT_SECS: u64 = 5;
const SHUTDOWN_WAIT_SECS: u64 = 3;
const MAX_CONSECUTIVE_FAILURES: u32 = 3;

#[derive(Deserialize)]
struct HealthResponse {
    #[allow(dead_code)]
    status: String,
}

static SUBMIT_TOKEN: OnceLock<String> = OnceLock::new();

/// Per-session secret required for LIVE (non-dry-run) submissions. Generated once,
/// injected into the sidecar at spawn as `JCC_SUBMIT_TOKEN`, and exposed to the
/// app's own webview via [`get_submit_token`]. A separate local process cannot
/// obtain it, so it cannot drive a real submission even though the sidecar port is
/// bound to localhost. This makes "never auto-submit" defense-in-depth, not UI-only.
fn submit_token() -> &'static str {
    SUBMIT_TOKEN.get_or_init(|| {
        use ring::rand::{SecureRandom, SystemRandom};
        let mut buf = [0u8; 32];
        SystemRandom::new().fill(&mut buf).expect("system rng");
        buf.iter().map(|byte| format!("{byte:02x}")).collect()
    })
}

/// Return the per-session submit token for the app's own webview. Reachable only
/// over Tauri IPC (the desktop app), never from another local process.
#[tauri::command]
#[specta::specta]
pub fn get_submit_token() -> String {
    submit_token().to_string()
}

pub struct SidecarManager {
    child: Option<tokio::process::Child>,
    state: SidecarState,
    restart_count: u32,
    started_at: Option<Instant>,
    consecutive_failures: u32,
    monitor_running: bool,
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self {
            child: None,
            state: SidecarState::Stopped,
            restart_count: 0,
            started_at: None,
            consecutive_failures: 0,
            monitor_running: false,
        }
    }
}

impl SidecarManager {
    fn status(&self) -> SidecarStatus {
        let pid = self.child.as_ref().and_then(|c| c.id());

        let uptime_seconds = self.started_at.map(|start| start.elapsed().as_secs_f64());

        SidecarStatus {
            state: self.state.clone(),
            pid,
            restart_count: self.restart_count,
            uptime_seconds,
        }
    }
}

pub type SharedSidecarManager = Arc<Mutex<SidecarManager>>;

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS))
        .build()
        .unwrap_or_default()
}

async fn check_health() -> bool {
    let client = http_client();
    let url = format!("{SIDECAR_BASE_URL}/health");
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => resp.json::<HealthResponse>().await.is_ok(),
        _ => false,
    }
}

async fn request_shutdown() -> bool {
    let client = http_client();
    let url = format!("{SIDECAR_BASE_URL}/shutdown");
    matches!(client.post(&url).send().await, Ok(resp) if resp.status().is_success())
}

fn emit_status(app: &AppHandle, status: &SidecarStatus) {
    if let Err(e) = app.emit("sidecar-status-changed", status) {
        log::warn!("Failed to emit sidecar status event: {e}");
    }
}

async fn spawn_python_process() -> Result<tokio::process::Child, String> {
    // In debug mode, run Python directly
    // In release mode, would use bundled binary
    let project_root =
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {e}"))?;

    // Try to find sidecar relative to the project root or executable
    let sidecar_script = if cfg!(debug_assertions) {
        // During development: look relative to src-tauri/
        let candidate = project_root.join("../sidecar/src/main.py");
        if candidate.exists() {
            candidate
        } else {
            // Also try from project root directly
            let alt = project_root.join("sidecar/src/main.py");
            if alt.exists() {
                alt
            } else {
                return Err(format!(
                    "Sidecar script not found. Checked:\n  {}\n  {}",
                    candidate.display(),
                    alt.display()
                ));
            }
        }
    } else {
        // In release: use bundled binary
        return Err("Release sidecar binary not yet implemented".to_string());
    };

    let sidecar_dir = sidecar_script
        .parent()
        .and_then(|p| p.parent())
        .ok_or("Failed to determine sidecar directory")?;

    // Check for venv and use its Python if available
    let venv_python = sidecar_dir.join(".venv/bin/python3");
    let python_cmd = if venv_python.exists() {
        venv_python.to_string_lossy().to_string()
    } else {
        "python3".to_string()
    };

    log::info!(
        "Spawning sidecar: {} {}",
        python_cmd,
        sidecar_script.display()
    );

    tokio::process::Command::new(&python_cmd)
        .arg(&sidecar_script)
        .env("JCC_SUBMIT_TOKEN", submit_token())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar process: {e}"))
}

/// Internal start logic shared by command and auto-start
pub async fn start_sidecar_internal(app: &AppHandle) -> Result<SidecarStatus, String> {
    let manager = app.state::<SharedSidecarManager>();

    // Check if already running by probing health endpoint
    if check_health().await {
        log::info!("Sidecar already running on port {SIDECAR_PORT}, adopting");
        let mut mgr = manager.lock().await;
        mgr.state = SidecarState::Healthy;
        mgr.started_at = Some(Instant::now());
        mgr.consecutive_failures = 0;
        let status = mgr.status();
        drop(mgr);
        emit_status(app, &status);
        return Ok(status);
    }

    // Update state to Starting
    {
        let mut mgr = manager.lock().await;
        if mgr.state == SidecarState::Healthy {
            return Ok(mgr.status());
        }
        mgr.state = SidecarState::Starting;
        let status = mgr.status();
        emit_status(app, &status);
    }

    // Spawn the process
    let child = spawn_python_process().await?;

    {
        let mut mgr = manager.lock().await;
        mgr.child = Some(child);
        mgr.started_at = Some(Instant::now());
    }

    // Poll for health with timeout
    let deadline = Instant::now() + std::time::Duration::from_secs(STARTUP_TIMEOUT_SECS);
    let mut healthy = false;

    while Instant::now() < deadline {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if check_health().await {
            healthy = true;
            break;
        }
    }

    let mut mgr = manager.lock().await;
    if healthy {
        mgr.state = SidecarState::Healthy;
        mgr.consecutive_failures = 0;
        log::info!("Sidecar started successfully on port {SIDECAR_PORT}");
    } else {
        mgr.state = SidecarState::Failed;
        log::error!("Sidecar failed to become healthy within {STARTUP_TIMEOUT_SECS}s");
    }

    let status = mgr.status();
    drop(mgr);
    emit_status(app, &status);
    Ok(status)
}

/// Internal stop logic
pub async fn stop_sidecar_internal(app: &AppHandle) -> Result<SidecarStatus, String> {
    let manager = app.state::<SharedSidecarManager>();

    // Try graceful shutdown via HTTP
    let _ = request_shutdown().await;

    // Wait for graceful exit
    tokio::time::sleep(std::time::Duration::from_secs(SHUTDOWN_WAIT_SECS)).await;

    let mut mgr = manager.lock().await;

    // If still has a child process, force kill
    if let Some(ref mut child) = mgr.child {
        // Check if process is still running
        match child.try_wait() {
            Ok(Some(_)) => {
                // Already exited
                log::info!("Sidecar exited gracefully");
            }
            Ok(None) => {
                // Still running, force kill
                log::warn!("Sidecar didn't exit gracefully, killing");
                let _ = child.kill().await;
            }
            Err(e) => {
                log::warn!("Failed to check sidecar status: {e}");
            }
        }
    }

    mgr.child = None;
    mgr.state = SidecarState::Stopped;
    mgr.started_at = None;
    mgr.consecutive_failures = 0;

    let status = mgr.status();
    drop(mgr);
    emit_status(app, &status);
    Ok(status)
}

/// Spawns a background health monitor task
pub fn spawn_health_monitor(app: AppHandle) {
    let manager = app.state::<SharedSidecarManager>().inner().clone();

    // Check if monitor is already running
    let already_running = {
        let mgr = tauri::async_runtime::block_on(manager.lock());
        mgr.monitor_running
    };

    if already_running {
        log::debug!("Health monitor already running, skipping");
        return;
    }

    // Mark as running
    {
        let mut mgr = tauri::async_runtime::block_on(manager.lock());
        mgr.monitor_running = true;
    }

    tauri::async_runtime::spawn(async move {
        log::info!("Sidecar health monitor started");
        let interval = std::time::Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS);

        loop {
            tokio::time::sleep(interval).await;

            // Read current state without holding lock during HTTP call
            let (current_state, restart_count) = {
                let mgr = manager.lock().await;
                (mgr.state.clone(), mgr.restart_count)
            };

            // Skip monitoring if stopped or failed
            match current_state {
                SidecarState::Stopped | SidecarState::Failed => continue,
                _ => {}
            }

            let is_healthy = check_health().await;

            let mut mgr = manager.lock().await;

            if is_healthy {
                if mgr.state != SidecarState::Healthy {
                    mgr.state = SidecarState::Healthy;
                    let status = mgr.status();
                    emit_status(&app, &status);
                }
                mgr.consecutive_failures = 0;
            } else {
                mgr.consecutive_failures += 1;
                log::warn!(
                    "Sidecar health check failed ({}/{})",
                    mgr.consecutive_failures,
                    MAX_CONSECUTIVE_FAILURES
                );

                if mgr.consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                    if restart_count < MAX_RESTART_ATTEMPTS {
                        log::warn!(
                            "Attempting sidecar restart ({}/{})",
                            restart_count + 1,
                            MAX_RESTART_ATTEMPTS
                        );

                        // Clean up old process
                        if let Some(ref mut child) = mgr.child {
                            let _ = child.kill().await;
                        }
                        mgr.child = None;
                        mgr.state = SidecarState::Starting;
                        mgr.restart_count += 1;
                        mgr.consecutive_failures = 0;

                        let status = mgr.status();
                        emit_status(&app, &status);
                        drop(mgr);

                        // Spawn new process
                        match spawn_python_process().await {
                            Ok(child) => {
                                let mut mgr = manager.lock().await;
                                mgr.child = Some(child);
                                mgr.started_at = Some(Instant::now());
                                // Will be checked healthy on next iteration
                            }
                            Err(e) => {
                                log::error!("Failed to restart sidecar: {e}");
                                let mut mgr = manager.lock().await;
                                mgr.state = SidecarState::Failed;
                                let status = mgr.status();
                                emit_status(&app, &status);
                            }
                        }
                    } else {
                        log::error!(
                            "Sidecar restart limit reached ({MAX_RESTART_ATTEMPTS}), giving up"
                        );
                        mgr.state = SidecarState::Failed;
                        let status = mgr.status();
                        emit_status(&app, &status);
                    }
                } else if mgr.state != SidecarState::Unhealthy {
                    mgr.state = SidecarState::Unhealthy;
                    let status = mgr.status();
                    emit_status(&app, &status);
                }
            }
        }
    });
}

// =============================================================================
// Tauri Commands
// =============================================================================

#[tauri::command]
#[specta::specta]
pub async fn start_sidecar(app: AppHandle) -> Result<SidecarStatus, String> {
    start_sidecar_internal(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn stop_sidecar(app: AppHandle) -> Result<SidecarStatus, String> {
    stop_sidecar_internal(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn check_sidecar_health(app: AppHandle) -> Result<SidecarStatus, String> {
    let manager = app.state::<SharedSidecarManager>();

    let is_healthy = check_health().await;

    let mut mgr = manager.lock().await;
    if is_healthy {
        if mgr.state != SidecarState::Healthy {
            mgr.state = SidecarState::Healthy;
            mgr.consecutive_failures = 0;
        }
    } else if mgr.state == SidecarState::Healthy {
        mgr.state = SidecarState::Unhealthy;
    }

    let status = mgr.status();
    drop(mgr);
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn get_sidecar_status(app: AppHandle) -> Result<SidecarStatus, String> {
    let manager = app.state::<SharedSidecarManager>();
    let mgr = manager.lock().await;
    Ok(mgr.status())
}
