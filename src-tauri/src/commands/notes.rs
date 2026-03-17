use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::types::{CreateNoteInput, Note, UpdateNoteInput};

const NOTE_COLUMNS: &str = "id, job_id, note_type, title, content, created_at, updated_at";

#[tauri::command]
#[specta::specta]
pub async fn list_notes_for_job(app: AppHandle, job_id: String) -> Result<Vec<Note>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, Note>(
        &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE job_id = ? ORDER BY created_at DESC"),
    )
    .bind(&job_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to list notes for job {job_id}: {e}");
        format!("Failed to list notes: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_note(app: AppHandle, id: String) -> Result<Option<Note>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, Note>(
        &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?"),
    )
    .bind(&id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to get note {id}: {e}");
        format!("Failed to get note: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn create_note(app: AppHandle, input: CreateNoteInput) -> Result<Note, String> {
    let pool = app.state::<SqlitePool>();
    let id = uuid::Uuid::now_v7().to_string();

    sqlx::query(
        "INSERT INTO notes (id, job_id, note_type, title, content) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.job_id)
    .bind(&input.note_type)
    .bind(&input.title)
    .bind(&input.content)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to create note: {e}");
        format!("Failed to create note: {e}")
    })?;

    sqlx::query_as::<_, Note>(
        &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?"),
    )
    .bind(&id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to retrieve created note: {e}");
        format!("Note created but could not be retrieved: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn update_note(app: AppHandle, id: String, input: UpdateNoteInput) -> Result<Note, String> {
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

    maybe_set!(title, "title");
    maybe_set!(content, "content");

    if set_clauses.is_empty() {
        return sqlx::query_as::<_, Note>(
            &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?"),
        )
        .bind(&id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("Failed to get note: {e}"))?
        .ok_or_else(|| "Note not found".to_string());
    }

    set_clauses.push("updated_at = datetime('now')".to_string());

    let sql = format!("UPDATE notes SET {} WHERE id = ?", set_clauses.join(", "));
    let mut query = sqlx::query(&sql);
    for val in &values {
        query = query.bind(val);
    }
    query = query.bind(&id);

    let result = query.execute(pool.inner()).await.map_err(|e| {
        log::error!("Failed to update note {id}: {e}");
        format!("Failed to update note: {e}")
    })?;

    if result.rows_affected() == 0 {
        return Err("Note not found".to_string());
    }

    sqlx::query_as::<_, Note>(
        &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?"),
    )
    .bind(&id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Note updated but could not be retrieved: {e}"))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_note(app: AppHandle, id: String) -> Result<bool, String> {
    let pool = app.state::<SqlitePool>();
    let result = sqlx::query("DELETE FROM notes WHERE id = ?")
        .bind(&id)
        .execute(pool.inner())
        .await
        .map_err(|e| {
            log::error!("Failed to delete note {id}: {e}");
            format!("Failed to delete note: {e}")
        })?;
    Ok(result.rows_affected() > 0)
}
