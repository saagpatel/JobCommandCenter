//! Tauri application library entry point.
//!
//! This module serves as the main entry point for the Tauri application.
//! Command implementations are organized in the `commands` module,
//! and shared types are in the `types` module.

mod bindings;
mod commands;
mod types;
mod utils;

use std::sync::Arc;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tauri::{Manager, RunEvent};
use tokio::sync::Mutex;

use commands::sidecar::{
    spawn_health_monitor, start_sidecar_internal, stop_sidecar_internal, SharedSidecarManager,
    SidecarManager,
};

// Re-export only what's needed externally
pub use types::DEFAULT_QUICK_PANE_SHORTCUT;

const MIGRATIONS: &[&str] = &[
    // Migration 1: jobs table
    "CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        ats TEXT NOT NULL,
        apply_url TEXT NOT NULL,
        job_posting_id TEXT,
        board_token TEXT,
        status TEXT NOT NULL DEFAULT 'saved',
        tier TEXT NOT NULL DEFAULT 'tier1',
        source TEXT DEFAULT 'Company careers page',
        resume_path TEXT,
        cover_letter_path TEXT,
        custom_fields TEXT DEFAULT '{}',
        notes TEXT DEFAULT '',
        applied_at TEXT,
        follow_up_date TEXT,
        response_date TEXT,
        salary_range TEXT,
        location TEXT,
        jd_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);",
    "CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);",
    // Migration 2: submissions table
    "CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        adapter TEXT NOT NULL,
        status TEXT NOT NULL,
        resume_uploaded INTEGER NOT NULL DEFAULT 0,
        cover_letter_uploaded INTEGER NOT NULL DEFAULT 0,
        fields_filled TEXT DEFAULT '[]',
        fields_skipped TEXT DEFAULT '[]',
        error TEXT,
        response_data TEXT,
        duration_seconds REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    "CREATE INDEX IF NOT EXISTS idx_submissions_job_id ON submissions(job_id);",
    // Migration 3: followups table
    "CREATE TABLE IF NOT EXISTS followups (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        draft_subject TEXT NOT NULL,
        draft_body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        scheduled_date TEXT NOT NULL,
        sent_at TEXT,
        gmail_message_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    "CREATE INDEX IF NOT EXISTS idx_followups_job_id ON followups(job_id);",
    "CREATE INDEX IF NOT EXISTS idx_followups_status_date ON followups(status, scheduled_date);",
    // Migration 4: notes table
    "CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        note_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    // Migration 5: profile table
    "CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        linkedin_url TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'San Francisco, CA',
        authorized_to_work INTEGER NOT NULL DEFAULT 1,
        requires_sponsorship INTEGER NOT NULL DEFAULT 0,
        preferred_name TEXT,
        base_resume_path TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    // Migration 6: Recreate followups table with nullable drafts and recipient_email
    "DROP TABLE IF EXISTS followups;",
    "CREATE TABLE IF NOT EXISTS followups (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        draft_subject TEXT,
        draft_body TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        scheduled_date TEXT NOT NULL,
        sent_at TEXT,
        gmail_message_id TEXT,
        recipient_email TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    "CREATE INDEX IF NOT EXISTS idx_followups_job_id ON followups(job_id);",
    "CREATE INDEX IF NOT EXISTS idx_followups_status_date ON followups(status, scheduled_date);",
    // Migration 7: Add follow_up_days to profile
    "ALTER TABLE profile ADD COLUMN follow_up_days INTEGER NOT NULL DEFAULT 7;",
];

/// Application entry point. Sets up all plugins and initializes the app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = bindings::generate_bindings();

    // Export TypeScript bindings in debug builds
    #[cfg(debug_assertions)]
    bindings::export_ts_bindings();

    // Build with common plugins
    let mut app_builder = tauri::Builder::default();

    // Single instance plugin must be registered FIRST
    // When user tries to open a second instance, focus the existing window instead
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }));
    }

    // Window state plugin - saves/restores window position and size
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all())
                .build(),
        );
    }

    // Updater plugin for in-app updates
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    app_builder = app_builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    #[cfg(target_os = "macos")]
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ])
                .build(),
        );

    // macOS: Add NSPanel plugin for native panel behavior
    #[cfg(target_os = "macos")]
    {
        app_builder = app_builder.plugin(tauri_nspanel::init());
    }

    app_builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            log::info!("Application starting up");
            log::debug!(
                "App handle initialized for package: {}",
                app.package_info().name
            );

            // Initialize sqlx pool for Rust command access to the same DB
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {e}"))?;

            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("Failed to create app data dir: {e}"))?;

            let db_path = app_data_dir.join("jcc.db");
            let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

            let pool = tauri::async_runtime::block_on(async {
                let pool = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect(&db_url)
                    .await
                    .map_err(|e| format!("Failed to connect to SQLite: {e}"))?;

                // Enable WAL mode for better concurrent access
                sqlx::query("PRAGMA journal_mode=WAL")
                    .execute(&pool)
                    .await
                    .map_err(|e| format!("Failed to set WAL mode: {e}"))?;

                // Enable foreign keys
                sqlx::query("PRAGMA foreign_keys=ON")
                    .execute(&pool)
                    .await
                    .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;

                // Give concurrent app/database work a short retry window instead of failing
                // immediately when SQLite is briefly locked.
                sqlx::query("PRAGMA busy_timeout=5000")
                    .execute(&pool)
                    .await
                    .map_err(|e| format!("Failed to set SQLite busy timeout: {e}"))?;

                // Run migrations
                for sql in MIGRATIONS {
                    let result = sqlx::query(sql).execute(&pool).await;
                    match result {
                        Ok(_) => {}
                        Err(e) => {
                            let msg = e.to_string();
                            // ALTER TABLE ADD COLUMN fails if column already exists — safe to skip
                            if msg.contains("duplicate column name") {
                                log::debug!("Migration skipped (column exists): {msg}");
                            } else {
                                return Err(format!("Migration failed: {e}"));
                            }
                        }
                    }
                }
                log::info!("Database migrations complete");

                Ok::<SqlitePool, String>(pool)
            })?;

            app.manage(pool);
            log::info!("SQLite pool initialized at {}", db_path.display());

            // Initialize sidecar manager
            let sidecar_manager: SharedSidecarManager =
                Arc::new(Mutex::new(SidecarManager::default()));
            app.manage(sidecar_manager);

            // Set up global shortcut plugin
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::Builder;
                app.handle().plugin(Builder::new().build())?;
            }

            // Load saved preferences and register the quick pane shortcut
            #[cfg(desktop)]
            {
                let saved_shortcut = commands::preferences::load_quick_pane_shortcut(app.handle());
                let shortcut_to_register = saved_shortcut
                    .as_deref()
                    .unwrap_or(DEFAULT_QUICK_PANE_SHORTCUT);

                log::info!("Registering quick pane shortcut: {shortcut_to_register}");
                commands::quick_pane::register_quick_pane_shortcut(
                    app.handle(),
                    shortcut_to_register,
                )?;
            }

            // Create the quick pane window (hidden)
            if let Err(e) = commands::quick_pane::init_quick_pane(app.handle()) {
                log::error!("Failed to create quick pane: {e}");
            }

            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Ready = event {
                // Auto-start sidecar and health monitor
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match start_sidecar_internal(&handle).await {
                        Ok(status) => {
                            log::info!("Sidecar auto-start: {:?}", status.state);
                        }
                        Err(e) => {
                            log::warn!("Sidecar auto-start failed: {e}");
                        }
                    }
                });
                spawn_health_monitor(app.clone());
            }

            if let RunEvent::ExitRequested { .. } = event {
                // Gracefully stop sidecar on app exit
                let handle = app.clone();
                tauri::async_runtime::block_on(async move {
                    match stop_sidecar_internal(&handle).await {
                        Ok(_) => log::info!("Sidecar stopped on exit"),
                        Err(e) => log::warn!("Failed to stop sidecar on exit: {e}"),
                    }
                });
            }
        });
}
