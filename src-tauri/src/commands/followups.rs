use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::types::{CreateFollowupInput, Followup, UpdateFollowupInput};

const FOLLOWUP_COLUMNS: &str = "id, job_id, draft_subject, draft_body, status, scheduled_date, sent_at, gmail_message_id, recipient_email, created_at";

#[tauri::command]
#[specta::specta]
pub async fn list_followups(app: AppHandle, status: Option<String>) -> Result<Vec<Followup>, String> {
    let pool = app.state::<SqlitePool>();
    let followups = match status {
        Some(ref s) => {
            sqlx::query_as::<_, Followup>(
                &format!("SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE status = ? ORDER BY scheduled_date ASC"),
            )
            .bind(s)
            .fetch_all(pool.inner())
            .await
        }
        None => {
            sqlx::query_as::<_, Followup>(
                &format!("SELECT {FOLLOWUP_COLUMNS} FROM followups ORDER BY scheduled_date ASC"),
            )
            .fetch_all(pool.inner())
            .await
        }
    };
    followups.map_err(|e| {
        log::error!("Failed to list followups: {e}");
        format!("Failed to list followups: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_followups_for_job(app: AppHandle, job_id: String) -> Result<Vec<Followup>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, Followup>(
        &format!("SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE job_id = ? ORDER BY scheduled_date ASC"),
    )
    .bind(&job_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to list followups for job {job_id}: {e}");
        format!("Failed to list followups: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn create_followup(app: AppHandle, input: CreateFollowupInput) -> Result<Followup, String> {
    let pool = app.state::<SqlitePool>();
    let id = uuid::Uuid::now_v7().to_string();

    sqlx::query(
        "INSERT INTO followups (id, job_id, status, scheduled_date, recipient_email) VALUES (?, ?, 'pending', ?, ?)",
    )
    .bind(&id)
    .bind(&input.job_id)
    .bind(&input.scheduled_date)
    .bind(&input.recipient_email)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to create followup: {e}");
        format!("Failed to create followup: {e}")
    })?;

    sqlx::query_as::<_, Followup>(
        &format!("SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE id = ?"),
    )
    .bind(&id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to retrieve created followup: {e}");
        format!("Followup created but could not be retrieved: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn update_followup(app: AppHandle, id: String, input: UpdateFollowupInput) -> Result<Followup, String> {
    let pool = app.state::<SqlitePool>();

    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();

    macro_rules! maybe_set {
        ($field:ident, $col:expr) => {
            if let Some(ref val) = input.$field {
                set_clauses.push(format!("{} = ?", $col));
                values.push(val.clone());
            }
        };
    }

    maybe_set!(draft_subject, "draft_subject");
    maybe_set!(draft_body, "draft_body");
    maybe_set!(status, "status");
    maybe_set!(scheduled_date, "scheduled_date");
    maybe_set!(sent_at, "sent_at");
    maybe_set!(gmail_message_id, "gmail_message_id");
    maybe_set!(recipient_email, "recipient_email");

    if set_clauses.is_empty() {
        return sqlx::query_as::<_, Followup>(
            &format!("SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE id = ?"),
        )
        .bind(&id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("Failed to get followup: {e}"))?
        .ok_or_else(|| "Followup not found".to_string());
    }

    let sql = format!("UPDATE followups SET {} WHERE id = ?", set_clauses.join(", "));
    let mut query = sqlx::query(&sql);
    for val in &values {
        query = query.bind(val);
    }
    query = query.bind(&id);

    let result = query.execute(pool.inner()).await.map_err(|e| {
        log::error!("Failed to update followup {id}: {e}");
        format!("Failed to update followup: {e}")
    })?;

    if result.rows_affected() == 0 {
        return Err("Followup not found".to_string());
    }

    sqlx::query_as::<_, Followup>(
        &format!("SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE id = ?"),
    )
    .bind(&id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Followup updated but could not be retrieved: {e}"))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_followup(app: AppHandle, id: String) -> Result<bool, String> {
    let pool = app.state::<SqlitePool>();
    let result = sqlx::query("DELETE FROM followups WHERE id = ?")
        .bind(&id)
        .execute(pool.inner())
        .await
        .map_err(|e| {
            log::error!("Failed to delete followup {id}: {e}");
            format!("Failed to delete followup: {e}")
        })?;
    Ok(result.rows_affected() > 0)
}
