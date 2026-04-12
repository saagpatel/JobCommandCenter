use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::types::{
    AdapterCount, PipelineFunnel, SidebarCounts, TierComparison, TierStats, WeeklyApplications,
};

#[tauri::command]
#[specta::specta]
pub async fn get_applications_by_week(app: AppHandle) -> Result<Vec<WeeklyApplications>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, WeeklyApplications>(
        "SELECT
            strftime('%Y-W%W', applied_at) as week,
            SUM(CASE WHEN tier = 'tier1' THEN 1 ELSE 0 END) as tier1_count,
            SUM(CASE WHEN tier = 'tier2' THEN 1 ELSE 0 END) as tier2_count
        FROM jobs
        WHERE applied_at IS NOT NULL
        GROUP BY strftime('%Y-W%W', applied_at)
        ORDER BY week ASC",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to get applications by week: {e}");
        format!("Failed to get applications by week: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_pipeline_funnel(app: AppHandle) -> Result<PipelineFunnel, String> {
    let pool = app.state::<SqlitePool>();

    let rows: Vec<(String, i32)> =
        sqlx::query_as("SELECT status, COUNT(*) as count FROM jobs GROUP BY status")
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Failed to get pipeline funnel: {e}"))?;

    let mut funnel = PipelineFunnel {
        saved: 0,
        applied: 0,
        interviewing: 0,
        offer: 0,
        rejected: 0,
    };

    for (status, count) in rows {
        match status.as_str() {
            "saved" => funnel.saved = count,
            "applied" => funnel.applied = count,
            "interviewing" => funnel.interviewing = count,
            "offer" => funnel.offer = count,
            "rejected" => funnel.rejected = count,
            _ => {}
        }
    }

    Ok(funnel)
}

#[tauri::command]
#[specta::specta]
pub async fn get_response_rate(app: AppHandle) -> Result<f64, String> {
    let pool = app.state::<SqlitePool>();

    let total_applied: i32 =
        sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE applied_at IS NOT NULL")
            .fetch_one(pool.inner())
            .await
            .map_err(|e| format!("Failed to get response rate: {e}"))?;

    if total_applied == 0 {
        return Ok(0.0);
    }

    let got_response: i32 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM jobs WHERE applied_at IS NOT NULL AND status NOT IN ('saved', 'applied')",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Failed to get response rate: {e}"))?;

    Ok(got_response as f64 / total_applied as f64)
}

#[tauri::command]
#[specta::specta]
pub async fn get_avg_days_to_response(app: AppHandle) -> Result<f64, String> {
    let pool = app.state::<SqlitePool>();

    let avg: Option<f64> = sqlx::query_scalar(
        "SELECT AVG(julianday(response_date) - julianday(applied_at))
        FROM jobs
        WHERE applied_at IS NOT NULL AND response_date IS NOT NULL",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Failed to get avg days to response: {e}"))?;

    Ok(avg.unwrap_or(0.0))
}

#[tauri::command]
#[specta::specta]
pub async fn get_submissions_by_adapter(app: AppHandle) -> Result<Vec<AdapterCount>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, AdapterCount>(
        "SELECT adapter, COUNT(*) as count
        FROM submissions
        GROUP BY adapter
        ORDER BY count DESC",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to get submissions by adapter: {e}");
        format!("Failed to get submissions by adapter: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_tier_comparison(app: AppHandle) -> Result<TierComparison, String> {
    let pool = app.state::<SqlitePool>();

    let rows: Vec<(String, i32, i32, i32)> = sqlx::query_as(
        "SELECT tier,
            SUM(CASE WHEN applied_at IS NOT NULL THEN 1 ELSE 0 END) as applied,
            SUM(CASE WHEN applied_at IS NOT NULL AND status NOT IN ('saved', 'applied') THEN 1 ELSE 0 END) as responded,
            SUM(CASE WHEN status = 'interviewing' THEN 1 ELSE 0 END) as interviewing
        FROM jobs
        WHERE tier IN ('tier1', 'tier2')
        GROUP BY tier",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to get tier comparison: {e}"))?;

    fn make_stats(applied: i32, responded: i32, interviewing: i32) -> TierStats {
        let response_rate = if applied > 0 {
            responded as f64 / applied as f64
        } else {
            0.0
        };
        TierStats {
            applied,
            responded,
            interviewing,
            response_rate,
        }
    }

    let mut tier1 = make_stats(0, 0, 0);
    let mut tier2 = make_stats(0, 0, 0);

    for (tier, applied, responded, interviewing) in rows {
        match tier.as_str() {
            "tier1" => tier1 = make_stats(applied, responded, interviewing),
            "tier2" => tier2 = make_stats(applied, responded, interviewing),
            _ => {}
        }
    }

    Ok(TierComparison { tier1, tier2 })
}

#[tauri::command]
#[specta::specta]
pub async fn get_sidebar_counts(app: AppHandle) -> Result<SidebarCounts, String> {
    let pool = app.state::<SqlitePool>();

    let followups_due: i32 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM followups
        WHERE status IN ('pending', 'draft_ready')
        AND scheduled_date <= datetime('now', '+3 days')",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Failed to get sidebar counts: {e}"))?;

    let prep_needed: i32 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM jobs
        WHERE status = 'interviewing'
        AND id NOT IN (
            SELECT job_id FROM notes WHERE note_type = 'interview_prep' AND content != ''
        )",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Failed to get sidebar counts: {e}"))?;

    Ok(SidebarCounts {
        followups_due,
        prep_needed,
    })
}
