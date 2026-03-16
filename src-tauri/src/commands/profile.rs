use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::types::{Profile, UpsertProfileInput};

#[tauri::command]
#[specta::specta]
pub async fn get_profile(app: AppHandle) -> Result<Option<Profile>, String> {
    let pool = app.state::<SqlitePool>();

    sqlx::query_as::<_, Profile>(
        "SELECT id, first_name, last_name, email, phone, linkedin_url, location, authorized_to_work, requires_sponsorship, preferred_name, base_resume_path, updated_at FROM profile WHERE id = 1",
    )
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to get profile: {e}");
        format!("Failed to get profile: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn upsert_profile(
    app: AppHandle,
    input: UpsertProfileInput,
) -> Result<Profile, String> {
    let pool = app.state::<SqlitePool>();
    let location = input.location.unwrap_or_else(|| "San Francisco, CA".to_string());
    let authorized = input.authorized_to_work.unwrap_or(true);
    let sponsorship = input.requires_sponsorship.unwrap_or(false);

    sqlx::query(
        "INSERT OR REPLACE INTO profile (id, first_name, last_name, email, phone, linkedin_url, location, authorized_to_work, requires_sponsorship, preferred_name, base_resume_path, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(&input.first_name)
    .bind(&input.last_name)
    .bind(&input.email)
    .bind(&input.phone)
    .bind(&input.linkedin_url)
    .bind(&location)
    .bind(authorized)
    .bind(sponsorship)
    .bind(&input.preferred_name)
    .bind(&input.base_resume_path)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to upsert profile: {e}");
        format!("Failed to upsert profile: {e}")
    })?;

    get_profile(app)
        .await?
        .ok_or_else(|| "Profile was saved but could not be retrieved".to_string())
}
