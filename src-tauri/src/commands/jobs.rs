use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::types::{CreateJobInput, Job, UpdateJobInput};
use crate::utils::maybe_set;

#[tauri::command]
#[specta::specta]
pub async fn list_jobs(app: AppHandle, status: Option<String>) -> Result<Vec<Job>, String> {
    let pool = app.state::<SqlitePool>();

    let jobs = match status {
        Some(ref s) => {
            sqlx::query_as::<_, Job>(
                "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, created_at, updated_at FROM jobs WHERE status = ? ORDER BY updated_at DESC",
            )
            .bind(s)
            .fetch_all(pool.inner())
            .await
        }
        None => {
            sqlx::query_as::<_, Job>(
                "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, created_at, updated_at FROM jobs ORDER BY updated_at DESC",
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

    sqlx::query_as::<_, Job>(
        "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, created_at, updated_at FROM jobs WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to get job {id}: {e}");
        format!("Failed to get job: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn create_job(app: AppHandle, input: CreateJobInput) -> Result<Job, String> {
    let pool = app.state::<SqlitePool>();
    let id = uuid::Uuid::now_v7().to_string();
    let status = input.status.unwrap_or_else(|| "saved".to_string());
    let tier = input.tier.unwrap_or_else(|| "tier1".to_string());
    let source = input.source.unwrap_or_else(|| "Company careers page".to_string());
    let custom_fields = input.custom_fields.unwrap_or_else(|| "{}".to_string());
    let notes = input.notes.unwrap_or_default();

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
    .execute(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to create job: {e}");
        format!("Failed to create job: {e}")
    })?;

    // Return the created job
    get_job(app, id)
        .await?
        .ok_or_else(|| "Job was created but could not be retrieved".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_job(
    app: AppHandle,
    id: String,
    input: UpdateJobInput,
) -> Result<Job, String> {
    let pool = app.state::<SqlitePool>();

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
    maybe_set!(input, set_clauses, values, cover_letter_path, "cover_letter_path");
    maybe_set!(input, set_clauses, values, custom_fields, "custom_fields");
    maybe_set!(input, set_clauses, values, notes, "notes");
    maybe_set!(input, set_clauses, values, applied_at, "applied_at");
    maybe_set!(input, set_clauses, values, follow_up_date, "follow_up_date");
    maybe_set!(input, set_clauses, values, response_date, "response_date");
    maybe_set!(input, set_clauses, values, salary_range, "salary_range");
    maybe_set!(input, set_clauses, values, location, "location");
    maybe_set!(input, set_clauses, values, jd_url, "jd_url");

    if set_clauses.is_empty() {
        return get_job(app, id)
            .await?
            .ok_or_else(|| "Job not found".to_string());
    }

    set_clauses.push("updated_at = datetime('now')".to_string());

    let sql = format!("UPDATE jobs SET {} WHERE id = ?", set_clauses.join(", "));
    let mut query = sqlx::query(&sql);

    for val in &values {
        query = query.bind(val);
    }
    query = query.bind(&id);

    let result = query.execute(pool.inner()).await.map_err(|e| {
        log::error!("Failed to update job {id}: {e}");
        format!("Failed to update job: {e}")
    })?;

    if result.rows_affected() == 0 {
        return Err("Job not found".to_string());
    }

    // Auto-create followup when status changes to "applied"
    if input.status.as_deref() == Some("applied") {
        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM followups WHERE job_id = ? AND status IN ('pending', 'draft_ready')"
        )
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        if existing == 0 {
            // Read follow-up interval from profile (default 7 days)
            let follow_up_days: i32 = sqlx::query_scalar(
                "SELECT follow_up_days FROM profile WHERE id = 1"
            )
            .fetch_optional(pool.inner())
            .await
            .ok()
            .flatten()
            .unwrap_or(7);

            let interval = format!("+{follow_up_days} days");
            let followup_id = uuid::Uuid::now_v7().to_string();
            let _ = sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date) VALUES (?, ?, 'pending', datetime('now', ?))"
            )
            .bind(&followup_id)
            .bind(&id)
            .bind(&interval)
            .execute(pool.inner())
            .await;
        }
    }

    // Auto-create interview prep note when status changes to "interviewing"
    if input.status.as_deref() == Some("interviewing") {
        let existing_prep: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notes WHERE job_id = ? AND note_type = 'interview_prep'"
        )
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        if existing_prep == 0 {
            // Fetch company/role for the title
            let job_info: Option<(String, String)> = sqlx::query_as(
                "SELECT company, role FROM jobs WHERE id = ?"
            )
            .bind(&id)
            .fetch_optional(pool.inner())
            .await
            .unwrap_or(None);

            let title = match job_info {
                Some((company, role)) => format!("Interview Prep: {} - {}", company, role),
                None => "Interview Prep".to_string(),
            };

            let note_id = uuid::Uuid::now_v7().to_string();
            let _ = sqlx::query(
                "INSERT INTO notes (id, job_id, note_type, title, content) VALUES (?, ?, 'interview_prep', ?, '')"
            )
            .bind(&note_id)
            .bind(&id)
            .bind(&title)
            .execute(pool.inner())
            .await;
        }
    }

    get_job(app, id)
        .await?
        .ok_or_else(|| "Job was updated but could not be retrieved".to_string())
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
