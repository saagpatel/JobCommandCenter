use sqlx::{AssertSqlSafe, SqlitePool};
use tauri::{AppHandle, Manager};

use crate::types::{RecordSubmissionReceiptInput, SubmissionReceipt};

const RECEIPT_COLUMNS: &str = "id, job_id, adapter, status, resume_uploaded, cover_letter_uploaded, fields_filled, fields_skipped, error, COALESCE(duration_seconds, 0.0) AS duration_seconds, created_at, resolved_at";

async fn record_with_pool(
    pool: &SqlitePool,
    input: &RecordSubmissionReceiptInput,
) -> Result<SubmissionReceipt, String> {
    let allowed_status = matches!(
        input.status.as_str(),
        "success" | "failed" | "manual_required" | "unknown_outcome"
    );
    if !allowed_status {
        return Err(format!(
            "Unsupported durable submission status: {}",
            input.status
        ));
    }
    if input.job_id.trim().is_empty() {
        return Err("Submission receipt requires an exact job id".to_string());
    }

    let id = uuid::Uuid::now_v7().to_string();
    let fields_filled = serde_json::to_string(&input.fields_filled)
        .map_err(|e| format!("Failed to serialize filled fields: {e}"))?;
    let fields_skipped = serde_json::to_string(&input.fields_skipped)
        .map_err(|e| format!("Failed to serialize skipped fields: {e}"))?;

    sqlx::query(
        "INSERT INTO submissions (
            id, job_id, adapter, status, resume_uploaded,
            cover_letter_uploaded, fields_filled, fields_skipped, error,
            duration_seconds, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), datetime('now')))",
    )
    .bind(&id)
    .bind(&input.job_id)
    .bind(&input.adapter)
    .bind(&input.status)
    .bind(input.resume_uploaded)
    .bind(input.cover_letter_uploaded)
    .bind(fields_filled)
    .bind(fields_skipped)
    .bind(&input.error)
    .bind(input.duration_seconds)
    .bind(&input.timestamp)
    .execute(pool)
    .await
    .map_err(|e| {
        log::error!(
            "Failed to record submission receipt for job {}: {e}",
            input.job_id
        );
        format!("Failed to record submission receipt: {e}")
    })?;

    sqlx::query_as::<_, SubmissionReceipt>(AssertSqlSafe(format!(
        "SELECT {RECEIPT_COLUMNS} FROM submissions WHERE id = ?"
    )))
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Receipt recorded but could not be retrieved: {e}"))
}

async fn list_unresolved_with_pool(pool: &SqlitePool) -> Result<Vec<SubmissionReceipt>, String> {
    sqlx::query_as::<_, SubmissionReceipt>(AssertSqlSafe(format!(
        "SELECT {RECEIPT_COLUMNS}
         FROM submissions
         WHERE status IN ('manual_required', 'unknown_outcome')
           AND resolved_at IS NULL
         ORDER BY created_at ASC, id ASC"
    )))
    .fetch_all(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to list unresolved submission receipts: {e}");
        format!("Failed to list unresolved submission receipts: {e}")
    })
}

async fn list_for_job_with_pool(
    pool: &SqlitePool,
    job_id: &str,
) -> Result<Vec<SubmissionReceipt>, String> {
    if job_id.trim().is_empty() {
        return Err("Listing submission receipts requires an exact job id".to_string());
    }
    sqlx::query_as::<_, SubmissionReceipt>(AssertSqlSafe(format!(
        "SELECT {RECEIPT_COLUMNS}
         FROM submissions
         WHERE job_id = ?
         ORDER BY created_at DESC, id DESC"
    )))
    .bind(job_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to list submission receipts for job {job_id}: {e}");
        format!("Failed to list submission receipts: {e}")
    })
}

async fn resolve_with_pool(pool: &SqlitePool, job_id: &str) -> Result<bool, String> {
    if job_id.trim().is_empty() {
        return Err("Resolving submission receipts requires an exact job id".to_string());
    }
    sqlx::query(
        "UPDATE submissions
         SET resolved_at = datetime('now')
         WHERE job_id = ?
           AND status IN ('manual_required', 'unknown_outcome')
           AND resolved_at IS NULL",
    )
    .bind(job_id)
    .execute(pool)
    .await
    .map(|result| result.rows_affected() > 0)
    .map_err(|e| {
        log::error!("Failed to resolve submission receipts for job {job_id}: {e}");
        format!("Failed to resolve submission receipts: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn record_submission_receipt(
    app: AppHandle,
    input: RecordSubmissionReceiptInput,
) -> Result<SubmissionReceipt, String> {
    record_with_pool(app.state::<SqlitePool>().inner(), &input).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_unresolved_submission_receipts(
    app: AppHandle,
) -> Result<Vec<SubmissionReceipt>, String> {
    list_unresolved_with_pool(app.state::<SqlitePool>().inner()).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_submission_receipts_for_job(
    app: AppHandle,
    job_id: String,
) -> Result<Vec<SubmissionReceipt>, String> {
    list_for_job_with_pool(app.state::<SqlitePool>().inner(), &job_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn resolve_submission_receipts(app: AppHandle, job_id: String) -> Result<bool, String> {
    resolve_with_pool(app.state::<SqlitePool>().inner(), &job_id).await
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
            "CREATE TABLE submissions (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                adapter TEXT NOT NULL,
                status TEXT NOT NULL,
                resume_uploaded INTEGER NOT NULL DEFAULT 0,
                cover_letter_uploaded INTEGER NOT NULL DEFAULT 0,
                fields_filled TEXT DEFAULT '[]',
                fields_skipped TEXT DEFAULT '[]',
                error TEXT,
                response_data TEXT,
                duration_seconds REAL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("schema");
        pool
    }

    fn input(status: &str) -> RecordSubmissionReceiptInput {
        RecordSubmissionReceiptInput {
            job_id: "exact-job-id".to_string(),
            adapter: "linkedin".to_string(),
            status: status.to_string(),
            resume_uploaded: false,
            cover_letter_uploaded: false,
            fields_filled: vec!["Email".to_string()],
            fields_skipped: vec![],
            error: Some("Sanitized manual handoff".to_string()),
            duration_seconds: 1.5,
            timestamp: "2026-07-17T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn unresolved_receipt_survives_requery_until_explicit_resolution() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            record_with_pool(&pool, &input("manual_required"))
                .await
                .expect("record");

            let relaunched = list_unresolved_with_pool(&pool).await.expect("list");
            assert_eq!(relaunched.len(), 1);
            assert_eq!(relaunched[0].job_id, "exact-job-id");
            assert_eq!(relaunched[0].fields_filled, "[\"Email\"]");
            let history = list_for_job_with_pool(&pool, "exact-job-id")
                .await
                .expect("history");
            assert_eq!(history.len(), 1);
            assert_eq!(history[0].status, "manual_required");

            assert!(resolve_with_pool(&pool, "exact-job-id")
                .await
                .expect("resolve"));
            assert!(list_unresolved_with_pool(&pool)
                .await
                .expect("list after resolve")
                .is_empty());
        });
    }

    #[test]
    fn rejects_non_terminal_and_jobless_receipts() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            assert!(record_with_pool(&pool, &input("dry_run")).await.is_err());
            let mut jobless = input("unknown_outcome");
            jobless.job_id = " ".to_string();
            assert!(record_with_pool(&pool, &jobless).await.is_err());
            assert!(list_for_job_with_pool(&pool, " ").await.is_err());
        });
    }
}
