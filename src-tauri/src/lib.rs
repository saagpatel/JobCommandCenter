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

const SCHEMA_VERSION: i64 = 5;

const SCHEMA_STATEMENTS: &[&str] = &[
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
    "ALTER TABLE submissions ADD COLUMN resolved_at TEXT;",
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
    "UPDATE followups SET status = 'draft_ready' WHERE status = 'draft';",
    "CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        note_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
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
    "ALTER TABLE profile ADD COLUMN follow_up_days INTEGER NOT NULL DEFAULT 7;",
    "ALTER TABLE jobs ADD COLUMN source_packet_id TEXT;",
    "ALTER TABLE jobs ADD COLUMN source_packet_version TEXT;",
    "ALTER TABLE jobs ADD COLUMN truth_status TEXT;",
    "CREATE TABLE IF NOT EXISTS packet_imports (
        packet_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    "INSERT OR IGNORE INTO packet_imports (packet_id, job_id)
        SELECT source_packet_id, MIN(id) FROM jobs
        WHERE source_packet_id IS NOT NULL GROUP BY source_packet_id;",
];

async fn upgrade_followups_schema(pool: &SqlitePool) -> Result<(), String> {
    let columns: Vec<(String, i64)> =
        sqlx::query_as("SELECT name, \"notnull\" FROM pragma_table_info('followups')")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to inspect followups schema: {e}"))?;
    let has_recipient = columns.iter().any(|(name, _)| name == "recipient_email");
    let drafts_nullable = columns
        .iter()
        .filter(|(name, _)| name == "draft_subject" || name == "draft_body")
        .all(|(_, not_null)| *not_null == 0);
    if has_recipient && drafts_nullable {
        return Ok(());
    }

    let mut transaction = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin followups migration: {e}"))?;
    sqlx::query("DROP INDEX IF EXISTS idx_followups_job_id")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to prepare followups migration: {e}"))?;
    sqlx::query("DROP INDEX IF EXISTS idx_followups_status_date")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to prepare followups migration: {e}"))?;
    sqlx::query("ALTER TABLE followups RENAME TO followups_legacy")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to preserve legacy followups: {e}"))?;
    sqlx::query(
        "CREATE TABLE followups (
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
        )",
    )
    .execute(&mut *transaction)
    .await
    .map_err(|e| format!("Failed to create upgraded followups table: {e}"))?;
    let recipient_select = if has_recipient {
        "recipient_email"
    } else {
        "NULL"
    };
    let copy_sql = format!(
        "INSERT INTO followups (
            id, job_id, draft_subject, draft_body, status, scheduled_date,
            sent_at, gmail_message_id, recipient_email, created_at
        )
        SELECT id, job_id, draft_subject, draft_body, status, scheduled_date,
            sent_at, gmail_message_id, {recipient_select}, created_at
        FROM followups_legacy"
    );
    sqlx::query(sqlx::AssertSqlSafe(copy_sql))
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to copy existing followups: {e}"))?;
    sqlx::query("DROP TABLE followups_legacy")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to finish followups migration: {e}"))?;
    sqlx::query("CREATE INDEX idx_followups_job_id ON followups(job_id)")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to recreate followups index: {e}"))?;
    sqlx::query("CREATE INDEX idx_followups_status_date ON followups(status, scheduled_date)")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to recreate followups index: {e}"))?;
    transaction
        .commit()
        .await
        .map_err(|e| format!("Failed to commit followups migration: {e}"))
}

async fn install_followup_invariant_triggers(pool: &SqlitePool) -> Result<(), String> {
    for statement in [
        "CREATE TRIGGER IF NOT EXISTS prevent_duplicate_active_followup_insert
         BEFORE INSERT ON followups
         WHEN NEW.status IN ('pending', 'draft_ready', 'send_unknown')
          AND EXISTS (
            SELECT 1 FROM followups
            WHERE job_id = NEW.job_id
              AND status IN ('pending', 'draft_ready', 'send_unknown')
          )
         BEGIN
           SELECT RAISE(ABORT, 'active follow-up already exists for this job');
         END;",
        "CREATE TRIGGER IF NOT EXISTS prevent_duplicate_active_followup_update
         BEFORE UPDATE OF job_id, status ON followups
         WHEN NEW.status IN ('pending', 'draft_ready', 'send_unknown')
          AND EXISTS (
            SELECT 1 FROM followups
            WHERE job_id = NEW.job_id
              AND id <> OLD.id
              AND status IN ('pending', 'draft_ready', 'send_unknown')
          )
         BEGIN
           SELECT RAISE(ABORT, 'active follow-up already exists for this job');
         END;",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to install follow-up invariant: {e}"))?;
    }
    Ok(())
}

async fn install_followup_history_schema(
    pool: &SqlitePool,
    backfill_legacy_rows: bool,
) -> Result<(), String> {
    for statement in [
        "CREATE TABLE IF NOT EXISTS followup_events (
            id TEXT PRIMARY KEY,
            followup_id TEXT NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
            from_status TEXT,
            to_status TEXT NOT NULL,
            reason TEXT NOT NULL CHECK (reason IN (
                'legacy_state_imported',
                'draft_generated',
                'draft_saved',
                'send_attempted',
                'gmail_accepted',
                'operator_verified_sent',
                'operator_verified_not_sent',
                'operator_skipped'
            )),
            occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
        "CREATE INDEX IF NOT EXISTS idx_followup_events_followup_time
            ON followup_events(followup_id, occurred_at, id)",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to install follow-up history: {e}"))?;
    }
    if backfill_legacy_rows {
        sqlx::query(
            "INSERT OR IGNORE INTO followup_events (
                id, followup_id, from_status, to_status, reason, occurred_at
            )
            SELECT
                'legacy:' || id, id, NULL, status, 'legacy_state_imported', created_at
            FROM followups",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to backfill follow-up history: {e}"))?;
    }
    Ok(())
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to initialize migration tracking: {e}"))?;

    let current: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to read migration version: {e}"))?;
    if current >= SCHEMA_VERSION {
        install_followup_history_schema(pool, false).await?;
        install_followup_invariant_triggers(pool).await?;
        return Ok(());
    }

    for statement in SCHEMA_STATEMENTS {
        if let Err(error) = sqlx::query(*statement).execute(pool).await {
            let message = error.to_string();
            if !message.contains("duplicate column name") {
                return Err(format!("Migration failed: {error}"));
            }
        }
    }
    upgrade_followups_schema(pool).await?;
    install_followup_history_schema(pool, true).await?;
    install_followup_invariant_triggers(pool).await?;
    sqlx::query("INSERT INTO schema_migrations (version) VALUES (?)")
        .bind(SCHEMA_VERSION)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to record migration version: {e}"))?;
    Ok(())
}

fn updater_plugin_enabled(config: Option<&serde_json::Value>) -> bool {
    config
        .and_then(|value| value.get("active"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

/// Application entry point. Sets up all plugins and initializes the app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = bindings::generate_bindings();
    let context = tauri::generate_context!();
    let updater_active = updater_plugin_enabled(context.config().plugins.0.get("updater"));

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

    // Updater registration is an explicit config opt-in. Disabled and malformed
    // configurations fail closed without installing a network-capable plugin.
    #[cfg(desktop)]
    if updater_active {
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

                run_migrations(&pool).await?;
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
        .build(context)
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

#[cfg(test)]
mod migration_tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;

    #[test]
    fn updater_plugin_registration_fails_closed() {
        assert!(!updater_plugin_enabled(None));
        assert!(!updater_plugin_enabled(Some(&serde_json::json!({}))));
        assert!(!updater_plugin_enabled(Some(
            &serde_json::json!({ "active": false })
        )));
        assert!(!updater_plugin_enabled(Some(
            &serde_json::json!({ "active": "true" })
        )));
        assert!(updater_plugin_enabled(Some(
            &serde_json::json!({ "active": true })
        )));
    }

    #[test]
    #[ignore = "requires JCC_MIGRATION_FIXTURE_DB pointing to a disposable database copy"]
    fn migration_upgrades_external_fixture_idempotently() {
        let fixture = std::env::var("JCC_MIGRATION_FIXTURE_DB")
            .expect("JCC_MIGRATION_FIXTURE_DB must point to a disposable database copy");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(&fixture)
                .create_if_missing(false)
                .foreign_keys(true);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("fixture database");
            let row_counts_before: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
                "SELECT
                    (SELECT COUNT(*) FROM jobs),
                    (SELECT COUNT(*) FROM submissions),
                    (SELECT COUNT(*) FROM followups),
                    (SELECT COUNT(*) FROM notes),
                    (SELECT COUNT(*) FROM profile),
                    (SELECT COUNT(*) FROM packet_imports)",
            )
            .fetch_one(&pool)
            .await
            .expect("pre-migration row counts");

            run_migrations(&pool)
                .await
                .expect("first fixture migration");
            run_migrations(&pool)
                .await
                .expect("repeat fixture migration");

            let row_counts_after: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
                "SELECT
                    (SELECT COUNT(*) FROM jobs),
                    (SELECT COUNT(*) FROM submissions),
                    (SELECT COUNT(*) FROM followups),
                    (SELECT COUNT(*) FROM notes),
                    (SELECT COUNT(*) FROM profile),
                    (SELECT COUNT(*) FROM packet_imports)",
            )
            .fetch_one(&pool)
            .await
            .expect("post-migration row counts");
            assert_eq!(row_counts_after, row_counts_before);

            let version: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
                    .fetch_one(&pool)
                    .await
                    .expect("schema version");
            assert_eq!(version, SCHEMA_VERSION);

            let quick_check: String = sqlx::query_scalar("PRAGMA quick_check")
                .fetch_one(&pool)
                .await
                .expect("quick check");
            assert_eq!(quick_check, "ok");
            let foreign_key_violations: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                    .fetch_one(&pool)
                    .await
                    .expect("foreign key check");
            assert_eq!(foreign_key_violations, 0);

            let installed_triggers: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'trigger'
                   AND name IN (
                     'prevent_duplicate_active_followup_insert',
                     'prevent_duplicate_active_followup_update'
                   )",
            )
            .fetch_one(&pool)
            .await
            .expect("follow-up invariant triggers");
            assert_eq!(installed_triggers, 2);

            let available_job: String = sqlx::query_scalar(
                "SELECT id FROM jobs
                 WHERE NOT EXISTS (
                   SELECT 1 FROM followups
                   WHERE followups.job_id = jobs.id
                     AND followups.status IN ('pending', 'draft_ready', 'send_unknown')
                 )
                 LIMIT 1",
            )
            .fetch_one(&pool)
            .await
            .expect("job available for rolled-back trigger probe");
            let mut probe = pool.begin().await.expect("trigger probe transaction");
            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date)
                 VALUES ('migration-probe-1', ?, 'pending', '2026-07-20')",
            )
            .bind(&available_job)
            .execute(&mut *probe)
            .await
            .expect("first active follow-up in probe");
            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date)
                 VALUES ('migration-probe-2', ?, 'pending', '2026-07-21')",
            )
            .bind(&available_job)
            .execute(&mut *probe)
            .await
            .expect_err("trigger must reject duplicate active follow-up");
            probe.rollback().await.expect("roll back trigger probe");
        });
    }

    #[test]
    fn migration_preserves_existing_duplicates_but_blocks_new_active_followups() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("database");
            sqlx::query(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO schema_migrations (version) VALUES (3);
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY,
                    company TEXT NOT NULL,
                    role TEXT NOT NULL,
                    ats TEXT NOT NULL,
                    apply_url TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'saved',
                    tier TEXT NOT NULL DEFAULT 'tier1',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO jobs (id, company, role, ats, apply_url)
                VALUES ('job-1', 'Acme', 'Engineer', 'greenhouse', 'https://example.test');
                CREATE TABLE followups (
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
                );
                INSERT INTO followups (id, job_id, status, scheduled_date)
                VALUES
                    ('existing-1', 'job-1', 'pending', '2026-07-18'),
                    ('existing-2', 'job-1', 'draft_ready', '2026-07-19');",
            )
            .execute(&pool)
            .await
            .expect("version 3 database with duplicate active followups");

            run_migrations(&pool)
                .await
                .expect("migration must preserve legacy evidence");

            let preserved: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM followups
                 WHERE job_id = 'job-1'
                 AND status IN ('pending', 'draft_ready', 'send_unknown')",
            )
            .fetch_one(&pool)
            .await
            .expect("preserved followups");
            assert_eq!(preserved, 2);

            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date)
                 VALUES ('new-active', 'job-1', 'pending', '2026-07-20')",
            )
            .execute(&pool)
            .await
            .expect_err("new duplicate active followup must be rejected");
        });
    }

    #[test]
    fn migration_adds_followup_history_without_inventing_legacy_transitions() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("database");
            sqlx::query(
                "PRAGMA foreign_keys = ON;
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO schema_migrations (version) VALUES (4);
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY,
                    company TEXT NOT NULL,
                    role TEXT NOT NULL,
                    ats TEXT NOT NULL,
                    apply_url TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'saved',
                    tier TEXT NOT NULL DEFAULT 'tier1',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO jobs (id, company, role, ats, apply_url)
                VALUES ('job-1', 'Acme', 'Engineer', 'greenhouse', 'https://example.test');
                CREATE TABLE followups (
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
                );
                INSERT INTO followups (
                    id, job_id, status, scheduled_date, created_at
                ) VALUES (
                    'followup-1', 'job-1', 'skipped', '2026-07-18',
                    '2026-07-17T12:00:00Z'
                );",
            )
            .execute(&pool)
            .await
            .expect("version 4 database");

            run_migrations(&pool).await.expect("version 5 migration");
            run_migrations(&pool).await.expect("idempotent relaunch");

            let event: (Option<String>, String, String, String) = sqlx::query_as(
                "SELECT from_status, to_status, reason, occurred_at
                 FROM followup_events WHERE followup_id = 'followup-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("legacy baseline event");
            assert_eq!(event.0, None);
            assert_eq!(event.1, "skipped");
            assert_eq!(event.2, "legacy_state_imported");
            assert_eq!(event.3, "2026-07-17T12:00:00Z");

            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date)
                 VALUES ('followup-after-v5', 'job-1', 'pending', '2026-07-19')",
            )
            .execute(&pool)
            .await
            .expect("post-migration follow-up");

            run_migrations(&pool).await.expect("idempotent relaunch");

            let event_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM followup_events WHERE followup_id = 'followup-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("history count");
            assert_eq!(
                event_count, 1,
                "relaunch must not duplicate baseline history"
            );
            let synthetic_new_history: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM followup_events
                 WHERE followup_id = 'followup-after-v5'",
            )
            .fetch_one(&pool)
            .await
            .expect("post-v5 history count");
            assert_eq!(
                synthetic_new_history, 0,
                "post-v5 rows must not be mislabeled as legacy"
            );

            let version: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
                    .fetch_one(&pool)
                    .await
                    .expect("schema version");
            assert_eq!(version, 5);
        });
    }

    #[test]
    fn migrations_preserve_followups_across_repeated_launches() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("database");
            sqlx::query(
                "CREATE TABLE jobs (
                    id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL,
                    ats TEXT NOT NULL, apply_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'saved',
                    tier TEXT NOT NULL DEFAULT 'tier1', created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
            )
            .execute(&pool)
            .await
            .expect("legacy jobs");
            sqlx::query(
                "INSERT INTO jobs (id, company, role, ats, apply_url)
                 VALUES ('job-1', 'Acme', 'Engineer', 'greenhouse', 'https://example.test')",
            )
            .execute(&pool)
            .await
            .expect("seed job");
            sqlx::query(
                "CREATE TABLE followups (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES jobs(id),
                    draft_subject TEXT NOT NULL,
                    draft_body TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'draft',
                    scheduled_date TEXT NOT NULL,
                    sent_at TEXT,
                    gmail_message_id TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
            )
            .execute(&pool)
            .await
            .expect("legacy followups");
            sqlx::query(
                "INSERT INTO followups (
                    id, job_id, draft_subject, draft_body, status, scheduled_date
                 ) VALUES ('followup-1', 'job-1', 'Hello', 'Checking in', 'draft', '2026-07-20')",
            )
            .execute(&pool)
            .await
            .expect("seed followup");

            run_migrations(&pool).await.expect("first launch migration");
            run_migrations(&pool).await.expect("second launch migration");

            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM followups WHERE id = 'followup-1'
                 AND draft_subject = 'Hello' AND draft_body = 'Checking in'
                 AND status = 'draft_ready'",
            )
            .fetch_one(&pool)
            .await
            .expect("read followup");
            assert_eq!(count, 1, "relaunch must not delete or duplicate followups");
        });
    }

    #[test]
    fn migration_adds_resolution_state_without_losing_submission_receipts() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("database");
            sqlx::query(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
            )
            .execute(&pool)
            .await
            .expect("migration tracking");
            sqlx::query("INSERT INTO schema_migrations (version) VALUES (1)")
                .execute(&pool)
                .await
                .expect("legacy version");
            sqlx::query(
                "CREATE TABLE jobs (
                    id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL,
                    ats TEXT NOT NULL, apply_url TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'saved',
                    tier TEXT NOT NULL DEFAULT 'tier1',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
            )
            .execute(&pool)
            .await
            .expect("legacy jobs");
            sqlx::query(
                "INSERT INTO jobs (id, company, role, ats, apply_url)
                 VALUES ('job-1', 'Acme', 'Engineer', 'linkedin', 'https://example.test')",
            )
            .execute(&pool)
            .await
            .expect("job");
            sqlx::query(
                "CREATE TABLE submissions (
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
                )",
            )
            .execute(&pool)
            .await
            .expect("legacy submissions");
            sqlx::query(
                "INSERT INTO submissions (id, job_id, adapter, status)
                 VALUES ('receipt-1', 'job-1', 'linkedin', 'manual_required')",
            )
            .execute(&pool)
            .await
            .expect("legacy receipt");

            run_migrations(&pool).await.expect("upgrade");

            let receipt: (String, Option<String>) = sqlx::query_as(
                "SELECT status, resolved_at FROM submissions WHERE id = 'receipt-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("preserved receipt");
            assert_eq!(receipt.0, "manual_required");
            assert_eq!(receipt.1, None);
            let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_migrations")
                .fetch_one(&pool)
                .await
                .expect("version");
            assert_eq!(version, SCHEMA_VERSION);
        });
    }
}
