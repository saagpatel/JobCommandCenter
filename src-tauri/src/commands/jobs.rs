use sqlx::{AssertSqlSafe, Sqlite, SqlitePool, Transaction};
use tauri::{AppHandle, Manager};

use crate::types::{CreateJobInput, Job, UpdateJobInput};
use crate::utils::maybe_set;

const JOB_LIFECYCLE_STATUSES: [&str; 5] = ["saved", "applied", "interviewing", "offer", "rejected"];
const JOB_BY_ID_QUERY: &str = "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, source_packet_id, source_packet_version, truth_status, created_at, updated_at FROM jobs WHERE id = ?";

fn validate_job_status(status: &str) -> Result<(), String> {
    if JOB_LIFECYCLE_STATUSES.contains(&status) {
        return Ok(());
    }

    Err(format!(
        "Unsupported job status: {status}. Expected one of: {}",
        JOB_LIFECYCLE_STATUSES.join(", ")
    ))
}

async fn get_with_pool(pool: &SqlitePool, id: &str) -> Result<Option<Job>, String> {
    sqlx::query_as::<_, Job>(JOB_BY_ID_QUERY)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to get job: {e}"))
}

async fn ensure_lifecycle_invariants(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
    status: &str,
) -> Result<(), String> {
    if matches!(status, "applied" | "interviewing" | "offer") {
        let result = sqlx::query(
            "UPDATE jobs
             SET applied_at = COALESCE(applied_at, datetime('now'))
             WHERE id = ?",
        )
        .bind(id)
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("Failed to record application time: {e}"))?;
        if result.rows_affected() == 0 {
            return Err("Job not found while recording application time".to_string());
        }
    }

    if matches!(status, "interviewing" | "offer") {
        let result = sqlx::query(
            "UPDATE jobs
             SET response_date = COALESCE(response_date, datetime('now'))
             WHERE id = ?",
        )
        .bind(id)
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("Failed to record response time: {e}"))?;
        if result.rows_affected() == 0 {
            return Err("Job not found while recording response time".to_string());
        }
    } else if status == "rejected" {
        sqlx::query(
            "UPDATE jobs
             SET response_date = COALESCE(response_date, datetime('now'))
             WHERE id = ? AND applied_at IS NOT NULL",
        )
        .bind(id)
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("Failed to record rejection response time: {e}"))?;
    }

    if status == "applied" {
        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM followups WHERE job_id = ? AND status IN ('pending', 'draft_ready', 'send_unknown')"
        )
        .bind(id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| format!("Failed to inspect applied follow-ups: {e}"))?;

        if existing == 0 {
            let follow_up_days: i32 =
                sqlx::query_scalar("SELECT follow_up_days FROM profile WHERE id = 1")
                    .fetch_optional(&mut **transaction)
                    .await
                    .map_err(|e| format!("Failed to read follow-up schedule: {e}"))?
                    .unwrap_or(7);

            let interval = format!("+{follow_up_days} days");
            let followup_id = uuid::Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date) VALUES (?, ?, 'pending', datetime('now', ?))"
            )
            .bind(&followup_id)
            .bind(id)
            .bind(&interval)
            .execute(&mut **transaction)
            .await
            .map_err(|e| format!("Failed to create applied follow-up: {e}"))?;
        }
    }

    if status == "interviewing" {
        let existing_prep: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notes WHERE job_id = ? AND note_type = 'interview_prep'",
        )
        .bind(id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| format!("Failed to inspect interview prep: {e}"))?;

        if existing_prep == 0 {
            let (company, role): (String, String) =
                sqlx::query_as("SELECT company, role FROM jobs WHERE id = ?")
                    .bind(id)
                    .fetch_one(&mut **transaction)
                    .await
                    .map_err(|e| format!("Failed to load job for interview prep: {e}"))?;
            let title = format!("Interview Prep: {company} - {role}");

            let note_id = uuid::Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO notes (id, job_id, note_type, title, content) VALUES (?, ?, 'interview_prep', ?, '')"
            )
            .bind(&note_id)
            .bind(id)
            .bind(&title)
            .execute(&mut **transaction)
            .await
            .map_err(|e| format!("Failed to create interview prep: {e}"))?;
        }
    }

    Ok(())
}

async fn validate_lifecycle_chronology(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<(), String> {
    let invalid: i64 = sqlx::query_scalar(
        "SELECT CASE
            WHEN response_date IS NOT NULL
             AND (
                applied_at IS NULL
                OR julianday(applied_at) IS NULL
                OR julianday(response_date) IS NULL
                OR julianday(response_date) < julianday(applied_at)
             )
            THEN 1
            ELSE 0
         END
         FROM jobs
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| format!("Failed to validate lifecycle chronology: {e}"))?;

    if invalid != 0 {
        return Err(
            "Response date requires a valid application time at or before the response".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_jobs(app: AppHandle, status: Option<String>) -> Result<Vec<Job>, String> {
    let pool = app.state::<SqlitePool>();

    let jobs = match status {
        Some(ref s) => {
            sqlx::query_as::<_, Job>(
                "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, source_packet_id, source_packet_version, truth_status, created_at, updated_at FROM jobs WHERE status = ? ORDER BY updated_at DESC",
            )
            .bind(s)
            .fetch_all(pool.inner())
            .await
        }
        None => {
            sqlx::query_as::<_, Job>(
                "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, source_packet_id, source_packet_version, truth_status, created_at, updated_at FROM jobs ORDER BY updated_at DESC",
            )
            .fetch_all(pool.inner())
            .await
        }
    };

    jobs.map_err(|e| {
        log::error!("Failed to list jobs: {e}");
        format!("Failed to list jobs: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_job(app: AppHandle, id: String) -> Result<Option<Job>, String> {
    let pool = app.state::<SqlitePool>();

    get_with_pool(pool.inner(), &id).await.map_err(|e| {
        log::error!("Failed to get job {id}: {e}");
        e
    })
}

#[tauri::command]
#[specta::specta]
pub async fn create_job(app: AppHandle, input: CreateJobInput) -> Result<Job, String> {
    let pool = app.state::<SqlitePool>();
    let result = create_with_pool(pool.inner(), input).await;
    if let Err(error) = &result {
        log::error!("Failed to create job: {error}");
    }
    result
}

async fn create_with_pool(pool: &SqlitePool, input: CreateJobInput) -> Result<Job, String> {
    let id = uuid::Uuid::now_v7().to_string();
    let status = input.status.unwrap_or_else(|| "saved".to_string());
    validate_job_status(&status)?;
    let tier = input.tier.unwrap_or_else(|| "tier1".to_string());
    let source = input
        .source
        .unwrap_or_else(|| "Company careers page".to_string());
    let custom_fields = input.custom_fields.unwrap_or_else(|| "{}".to_string());
    let notes = input.notes.unwrap_or_default();
    let mut transaction = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin job creation: {e}"))?;

    sqlx::query(
        "INSERT INTO jobs (id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, salary_range, location, jd_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.company)
    .bind(&input.role)
    .bind(&input.ats)
    .bind(&input.apply_url)
    .bind(&input.job_posting_id)
    .bind(&input.board_token)
    .bind(&status)
    .bind(&tier)
    .bind(&source)
    .bind(&input.resume_path)
    .bind(&input.cover_letter_path)
    .bind(&custom_fields)
    .bind(&notes)
    .bind(&input.salary_range)
    .bind(&input.location)
    .bind(&input.jd_url)
    .execute(&mut *transaction)
    .await
    .map_err(|e| format!("Failed to create job: {e}"))?;

    ensure_lifecycle_invariants(&mut transaction, &id, &status).await?;
    validate_lifecycle_chronology(&mut transaction, &id).await?;
    let job = sqlx::query_as::<_, Job>(JOB_BY_ID_QUERY)
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| format!("Job was created but could not be retrieved: {e}"))?;
    transaction
        .commit()
        .await
        .map_err(|e| format!("Failed to commit job creation: {e}"))?;
    Ok(job)
}

#[tauri::command]
#[specta::specta]
pub async fn update_job(app: AppHandle, id: String, input: UpdateJobInput) -> Result<Job, String> {
    let pool = app.state::<SqlitePool>();
    let result = update_with_pool(pool.inner(), &id, input).await;
    if let Err(error) = &result {
        log::error!("Failed to update job {id}: {error}");
    }
    result
}

async fn update_with_pool(
    pool: &SqlitePool,
    id: &str,
    input: UpdateJobInput,
) -> Result<Job, String> {
    if let Some(status) = input.status.as_deref() {
        validate_job_status(status)?;
    }
    let touches_chronology =
        input.status.is_some() || input.applied_at.is_some() || input.response_date.is_some();

    // Build dynamic UPDATE — only set fields that are Some
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();

    maybe_set!(input, set_clauses, values, company, "company");
    maybe_set!(input, set_clauses, values, role, "role");
    maybe_set!(input, set_clauses, values, ats, "ats");
    maybe_set!(input, set_clauses, values, apply_url, "apply_url");
    maybe_set!(input, set_clauses, values, job_posting_id, "job_posting_id");
    maybe_set!(input, set_clauses, values, board_token, "board_token");
    maybe_set!(input, set_clauses, values, status, "status");
    maybe_set!(input, set_clauses, values, tier, "tier");
    maybe_set!(input, set_clauses, values, source, "source");
    maybe_set!(input, set_clauses, values, resume_path, "resume_path");
    maybe_set!(
        input,
        set_clauses,
        values,
        cover_letter_path,
        "cover_letter_path"
    );
    maybe_set!(input, set_clauses, values, custom_fields, "custom_fields");
    maybe_set!(input, set_clauses, values, notes, "notes");
    maybe_set!(input, set_clauses, values, applied_at, "applied_at");
    maybe_set!(input, set_clauses, values, follow_up_date, "follow_up_date");
    maybe_set!(input, set_clauses, values, response_date, "response_date");
    maybe_set!(input, set_clauses, values, salary_range, "salary_range");
    maybe_set!(input, set_clauses, values, location, "location");
    maybe_set!(input, set_clauses, values, jd_url, "jd_url");

    if set_clauses.is_empty() {
        return get_with_pool(pool, id)
            .await?
            .ok_or_else(|| "Job not found".to_string());
    }

    let mut transaction = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin job update: {e}"))?;

    set_clauses.push("updated_at = datetime('now')".to_string());

    // Column fragments come only from the literal allowlist in maybe_set!; values stay bound.
    let sql = format!("UPDATE jobs SET {} WHERE id = ?", set_clauses.join(", "));
    let mut query = sqlx::query(AssertSqlSafe(sql));

    for val in &values {
        query = query.bind(val);
    }
    query = query.bind(id);

    let result = query
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("Failed to update job: {e}"))?;

    if result.rows_affected() == 0 {
        return Err("Job not found".to_string());
    }

    if let Some(status) = input.status.as_deref() {
        ensure_lifecycle_invariants(&mut transaction, id, status).await?;
    }
    if touches_chronology {
        validate_lifecycle_chronology(&mut transaction, id).await?;
    }

    let job = sqlx::query_as::<_, Job>(JOB_BY_ID_QUERY)
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| format!("Job was updated but could not be retrieved: {e}"))?;
    transaction
        .commit()
        .await
        .map_err(|e| format!("Failed to commit job update: {e}"))?;
    Ok(job)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_job(app: AppHandle, id: String) -> Result<bool, String> {
    let pool = app.state::<SqlitePool>();

    // Use a transaction to delete child records first, then the job
    let mut tx = pool.begin().await.map_err(|e| {
        log::error!("Failed to begin transaction for delete_job {id}: {e}");
        format!("Failed to delete job: {e}")
    })?;

    // Delete child records (no ON DELETE CASCADE in schema)
    sqlx::query("DELETE FROM submissions WHERE job_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            log::error!("Failed to delete submissions for job {id}: {e}");
            format!("Failed to delete job submissions: {e}")
        })?;

    sqlx::query("DELETE FROM followups WHERE job_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            log::error!("Failed to delete followups for job {id}: {e}");
            format!("Failed to delete job followups: {e}")
        })?;

    sqlx::query("DELETE FROM notes WHERE job_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            log::error!("Failed to delete notes for job {id}: {e}");
            format!("Failed to delete job notes: {e}")
        })?;

    let result = sqlx::query("DELETE FROM jobs WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            log::error!("Failed to delete job {id}: {e}");
            format!("Failed to delete job: {e}")
        })?;

    tx.commit().await.map_err(|e| {
        log::error!("Failed to commit delete_job transaction for {id}: {e}");
        format!("Failed to delete job: {e}")
    })?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("database");
        sqlx::query(
            "CREATE TABLE jobs (
                id TEXT PRIMARY KEY,
                company TEXT NOT NULL,
                role TEXT NOT NULL,
                ats TEXT NOT NULL,
                apply_url TEXT NOT NULL,
                job_posting_id TEXT,
                board_token TEXT,
                status TEXT NOT NULL DEFAULT 'saved',
                tier TEXT NOT NULL DEFAULT 'tier1',
                source TEXT,
                resume_path TEXT,
                cover_letter_path TEXT,
                custom_fields TEXT,
                notes TEXT,
                applied_at TEXT,
                follow_up_date TEXT,
                response_date TEXT,
                salary_range TEXT,
                location TEXT,
                jd_url TEXT,
                source_packet_id TEXT,
                source_packet_version TEXT,
                truth_status TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE followups (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                status TEXT NOT NULL,
                scheduled_date TEXT NOT NULL
            );
            CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                note_type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL
            );
            CREATE TABLE profile (
                id INTEGER PRIMARY KEY,
                follow_up_days INTEGER NOT NULL
            );
            INSERT INTO jobs (id, company, role, ats, apply_url)
            VALUES ('job-1', 'Example Corp', 'Engineer', 'generic', 'https://example.invalid');",
        )
        .execute(&pool)
        .await
        .expect("schema");
        pool
    }

    fn status_update(status: &str) -> UpdateJobInput {
        UpdateJobInput {
            company: None,
            role: None,
            ats: None,
            apply_url: None,
            status: Some(status.to_string()),
            tier: None,
            job_posting_id: None,
            board_token: None,
            source: None,
            resume_path: None,
            cover_letter_path: None,
            custom_fields: None,
            notes: None,
            applied_at: None,
            follow_up_date: None,
            response_date: None,
            salary_range: None,
            location: None,
            jd_url: None,
        }
    }

    fn create_input(status: &str) -> CreateJobInput {
        CreateJobInput {
            company: "New Corp".to_string(),
            role: "New Role".to_string(),
            ats: "generic".to_string(),
            apply_url: "https://example.invalid/new".to_string(),
            status: Some(status.to_string()),
            tier: None,
            job_posting_id: None,
            board_token: None,
            source: None,
            resume_path: None,
            cover_letter_path: None,
            custom_fields: None,
            notes: None,
            salary_range: None,
            location: None,
            jd_url: None,
        }
    }

    #[test]
    fn accepts_every_supported_job_lifecycle_status() {
        for status in ["saved", "applied", "interviewing", "offer", "rejected"] {
            assert_eq!(validate_job_status(status), Ok(()));
        }
    }

    #[test]
    fn rejects_values_outside_the_job_lifecycle_contract() {
        for status in ["", "saved ", "unknown-job-id", "withdrawn"] {
            let error = validate_job_status(status).expect_err("unsupported status must fail");
            assert!(
                error.starts_with("Unsupported job status:"),
                "unexpected validation error: {error}"
            );
            assert!(
                error.contains("saved, applied, interviewing, offer, rejected"),
                "error must explain the accepted contract: {error}"
            );
        }
    }

    #[test]
    fn applied_status_rolls_back_when_followup_creation_fails() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "CREATE TRIGGER fail_followup_insert
                 BEFORE INSERT ON followups
                 BEGIN
                     SELECT RAISE(ABORT, 'forced followup failure');
                 END;",
            )
            .execute(&pool)
            .await
            .expect("failure trigger");

            let error = update_with_pool(&pool, "job-1", status_update("applied"))
                .await
                .expect_err("derived insert must fail the lifecycle update");

            assert!(error.contains("Failed to create applied follow-up"));
            let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id = 'job-1'")
                .fetch_one(&pool)
                .await
                .expect("status");
            assert_eq!(status, "saved");
            let applied_at: Option<String> =
                sqlx::query_scalar("SELECT applied_at FROM jobs WHERE id = 'job-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("applied timestamp");
            assert_eq!(applied_at, None);
            let response_date: Option<String> =
                sqlx::query_scalar("SELECT response_date FROM jobs WHERE id = 'job-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("response timestamp");
            assert_eq!(response_date, None);
        });
    }

    #[test]
    fn interviewing_status_rolls_back_when_prep_creation_fails() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "CREATE TRIGGER fail_note_insert
                 BEFORE INSERT ON notes
                 BEGIN
                     SELECT RAISE(ABORT, 'forced note failure');
                 END;",
            )
            .execute(&pool)
            .await
            .expect("failure trigger");

            let error = update_with_pool(&pool, "job-1", status_update("interviewing"))
                .await
                .expect_err("derived insert must fail the lifecycle update");

            assert!(error.contains("Failed to create interview prep"));
            let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id = 'job-1'")
                .fetch_one(&pool)
                .await
                .expect("status");
            assert_eq!(status, "saved");
            let applied_at: Option<String> =
                sqlx::query_scalar("SELECT applied_at FROM jobs WHERE id = 'job-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("applied timestamp");
            assert_eq!(applied_at, None);
            let response_date: Option<String> =
                sqlx::query_scalar("SELECT response_date FROM jobs WHERE id = 'job-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("response timestamp");
            assert_eq!(response_date, None);
        });
    }

    #[test]
    fn lifecycle_update_commits_required_artifacts_without_duplicates() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;

            let applied = update_with_pool(&pool, "job-1", status_update("applied"))
                .await
                .expect("applied update");
            assert_eq!(applied.status, "applied");
            assert!(applied.applied_at.is_some());
            update_with_pool(&pool, "job-1", status_update("applied"))
                .await
                .expect("repeated applied update");
            let followups: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM followups WHERE job_id = 'job-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("followups");
            assert_eq!(followups, 1);

            let interviewing = update_with_pool(&pool, "job-1", status_update("interviewing"))
                .await
                .expect("interviewing update");
            assert_eq!(interviewing.status, "interviewing");
            update_with_pool(&pool, "job-1", status_update("interviewing"))
                .await
                .expect("repeated interviewing update");
            let prep_notes: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM notes WHERE job_id = 'job-1' AND note_type = 'interview_prep'",
            )
            .fetch_one(&pool)
            .await
            .expect("prep notes");
            assert_eq!(prep_notes, 1);
        });
    }

    #[test]
    fn unresolved_send_outcome_blocks_duplicate_applied_followup() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date)
                 VALUES ('unknown-followup', 'job-1', 'send_unknown', '2026-07-18')",
            )
            .execute(&pool)
            .await
            .expect("ambiguous follow-up");

            update_with_pool(&pool, "job-1", status_update("applied"))
                .await
                .expect("applied update");

            let followups: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM followups WHERE job_id = 'job-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("followups");
            assert_eq!(
                followups, 1,
                "an unresolved send outcome must block replacement follow-up creation"
            );
        });
    }

    #[test]
    fn lifecycle_create_commits_artifact_or_rolls_back_the_job() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let healthy_pool = test_pool().await;
            let interviewing = create_with_pool(&healthy_pool, create_input("interviewing"))
                .await
                .expect("interviewing create");
            let prep_notes: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM notes WHERE job_id = ? AND note_type = 'interview_prep'",
            )
            .bind(&interviewing.id)
            .fetch_one(&healthy_pool)
            .await
            .expect("prep notes");
            assert_eq!(prep_notes, 1);

            let failing_pool = test_pool().await;
            sqlx::query(
                "CREATE TRIGGER fail_followup_insert_on_create
                 BEFORE INSERT ON followups
                 BEGIN
                     SELECT RAISE(ABORT, 'forced create followup failure');
                 END;",
            )
            .execute(&failing_pool)
            .await
            .expect("failure trigger");
            create_with_pool(&failing_pool, create_input("applied"))
                .await
                .expect_err("derived insert must fail the job creation");
            let created_jobs: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE company = 'New Corp'")
                    .fetch_one(&failing_pool)
                    .await
                    .expect("created jobs");
            assert_eq!(created_jobs, 0);
        });
    }

    #[test]
    fn application_timestamp_tracks_only_confirmed_application_stages() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            for (status, expects_application, expects_response) in [
                ("saved", false, false),
                ("applied", true, false),
                ("interviewing", true, true),
                ("offer", true, true),
                ("rejected", false, false),
            ] {
                let pool = test_pool().await;
                let job = create_with_pool(&pool, create_input(status))
                    .await
                    .expect("job creation");
                assert_eq!(
                    job.applied_at.is_some(),
                    expects_application,
                    "unexpected application timestamp policy for {status}"
                );
                assert_eq!(
                    job.response_date.is_some(),
                    expects_response,
                    "unexpected response timestamp policy for {status}"
                );
            }
        });
    }

    #[test]
    fn later_stage_transition_preserves_the_original_application_time() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "UPDATE jobs
                 SET applied_at = '2026-07-01 12:34:56',
                     response_date = '2026-07-03 09:10:11'
                 WHERE id = 'job-1'",
            )
            .execute(&pool)
            .await
            .expect("seed lifecycle times");

            let offered = update_with_pool(&pool, "job-1", status_update("offer"))
                .await
                .expect("offer update");

            assert_eq!(offered.applied_at.as_deref(), Some("2026-07-01 12:34:56"));
            assert_eq!(
                offered.response_date.as_deref(),
                Some("2026-07-03 09:10:11")
            );

            let explicit_pool = test_pool().await;
            let mut explicit_update = status_update("applied");
            explicit_update.applied_at = Some("2026-07-02T08:09:10Z".to_string());
            let applied = update_with_pool(&explicit_pool, "job-1", explicit_update)
                .await
                .expect("explicit application time");
            assert_eq!(applied.applied_at.as_deref(), Some("2026-07-02T08:09:10Z"));
        });
    }

    #[test]
    fn rejected_records_a_response_only_after_an_application() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let archived_pool = test_pool().await;
            let archived = update_with_pool(&archived_pool, "job-1", status_update("rejected"))
                .await
                .expect("archive update");
            assert_eq!(archived.applied_at, None);
            assert_eq!(archived.response_date, None);

            let rejected_pool = test_pool().await;
            let applied = update_with_pool(&rejected_pool, "job-1", status_update("applied"))
                .await
                .expect("applied update");
            let rejected = update_with_pool(&rejected_pool, "job-1", status_update("rejected"))
                .await
                .expect("rejected update");
            assert_eq!(rejected.applied_at, applied.applied_at);
            assert!(rejected.response_date.is_some());
        });
    }

    #[test]
    fn direct_response_edits_must_follow_a_valid_application_time() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let never_applied_pool = test_pool().await;
            let mut response_only = status_update("saved");
            response_only.status = None;
            response_only.response_date = Some("2026-07-03T09:10:11Z".to_string());
            update_with_pool(&never_applied_pool, "job-1", response_only)
                .await
                .expect_err("response without application must fail");
            let response_date: Option<String> =
                sqlx::query_scalar("SELECT response_date FROM jobs WHERE id = 'job-1'")
                    .fetch_one(&never_applied_pool)
                    .await
                    .expect("response timestamp");
            assert_eq!(response_date, None);

            let reversed_pool = test_pool().await;
            sqlx::query("UPDATE jobs SET applied_at = '2026-07-04T09:10:11Z' WHERE id = 'job-1'")
                .execute(&reversed_pool)
                .await
                .expect("application time");
            let mut reversed = status_update("saved");
            reversed.status = None;
            reversed.response_date = Some("2026-07-03T09:10:11Z".to_string());
            update_with_pool(&reversed_pool, "job-1", reversed)
                .await
                .expect_err("response before application must fail");

            let valid_pool = test_pool().await;
            sqlx::query("UPDATE jobs SET applied_at = '2026-07-02T09:10:11Z' WHERE id = 'job-1'")
                .execute(&valid_pool)
                .await
                .expect("application time");
            let mut valid = status_update("saved");
            valid.status = None;
            valid.response_date = Some("2026-07-03T09:10:11Z".to_string());
            let updated = update_with_pool(&valid_pool, "job-1", valid)
                .await
                .expect("valid response chronology");
            assert_eq!(
                updated.response_date.as_deref(),
                Some("2026-07-03T09:10:11Z")
            );
        });
    }
}
