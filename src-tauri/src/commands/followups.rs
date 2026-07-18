use sqlx::{AssertSqlSafe, SqlitePool};
use tauri::{AppHandle, Manager};

use crate::types::{CreateFollowupInput, Followup, FollowupEvent, UpdateFollowupInput};
use crate::utils::maybe_set;

const FOLLOWUP_LIFECYCLE_STATUSES: [&str; 5] =
    ["pending", "draft_ready", "send_unknown", "sent", "skipped"];
const FOLLOWUP_COLUMNS: &str = "id, job_id, draft_subject, draft_body, status, scheduled_date, sent_at, gmail_message_id, recipient_email, created_at";
const FOLLOWUP_EVENT_COLUMNS: &str = "id, followup_id, from_status, to_status, reason, occurred_at";

fn validate_followup_status(status: &str) -> Result<(), String> {
    if FOLLOWUP_LIFECYCLE_STATUSES.contains(&status) {
        return Ok(());
    }

    Err(format!(
        "Unsupported follow-up status: {status}. Expected one of: {}",
        FOLLOWUP_LIFECYCLE_STATUSES.join(", ")
    ))
}

fn validate_followup_transition(current: &str, target: &str) -> Result<(), String> {
    validate_followup_status(current)?;
    validate_followup_status(target)?;

    let supported = current == target
        || matches!(
            (current, target),
            ("pending", "draft_ready" | "send_unknown" | "skipped")
                | ("draft_ready", "send_unknown" | "skipped")
                | ("send_unknown", "sent" | "draft_ready")
        );
    if supported {
        return Ok(());
    }

    Err(format!(
        "Unsupported follow-up transition: {current} -> {target}"
    ))
}

fn validate_transition_reason(
    current: &str,
    target: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    if current == target {
        return if reason.is_none() {
            Ok(())
        } else {
            Err("A transition reason is only allowed when follow-up status changes".to_string())
        };
    }

    let supported = matches!(
        (current, target, reason),
        (
            "pending",
            "draft_ready",
            Some("draft_generated" | "draft_saved")
        ) | (
            "pending" | "draft_ready",
            "send_unknown",
            Some("send_attempted")
        ) | (
            "pending" | "draft_ready",
            "skipped",
            Some("operator_skipped")
        ) | (
            "send_unknown",
            "sent",
            Some("gmail_accepted" | "operator_verified_sent")
        ) | (
            "send_unknown",
            "draft_ready",
            Some("operator_verified_not_sent")
        )
    );
    if supported {
        return Ok(());
    }

    Err(format!(
        "Follow-up transition {current} -> {target} requires a compatible transition reason"
    ))
}

fn require_non_blank(value: Option<&str>, field: &str, status: &str) -> Result<(), String> {
    if value.is_some_and(|candidate| !candidate.trim().is_empty()) {
        return Ok(());
    }

    Err(format!(
        "Follow-up status {status} requires a non-empty {field}"
    ))
}

fn validate_followup_state(
    status: &str,
    draft_subject: Option<&str>,
    draft_body: Option<&str>,
    recipient_email: Option<&str>,
    sent_at: Option<&str>,
) -> Result<(), String> {
    if matches!(status, "draft_ready" | "send_unknown" | "sent") {
        require_non_blank(draft_subject, "draft_subject", status)?;
        require_non_blank(draft_body, "draft_body", status)?;
    }
    if matches!(status, "send_unknown" | "sent") {
        require_non_blank(recipient_email, "recipient_email", status)?;
    }
    if status == "sent" {
        require_non_blank(sent_at, "sent_at", status)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_followups(
    app: AppHandle,
    status: Option<String>,
) -> Result<Vec<Followup>, String> {
    let pool = app.state::<SqlitePool>();
    let followups = match status {
        Some(ref s) => {
            sqlx::query_as::<_, Followup>(AssertSqlSafe(format!(
            "SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE status = ? ORDER BY scheduled_date ASC"
        )))
            .bind(s)
            .fetch_all(pool.inner())
            .await
        }
        None => {
            sqlx::query_as::<_, Followup>(AssertSqlSafe(format!(
                "SELECT {FOLLOWUP_COLUMNS} FROM followups ORDER BY scheduled_date ASC"
            )))
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
pub async fn list_followups_for_job(
    app: AppHandle,
    job_id: String,
) -> Result<Vec<Followup>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, Followup>(AssertSqlSafe(format!(
        "SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE job_id = ? ORDER BY scheduled_date ASC"
    )))
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
pub async fn list_followup_events(
    app: AppHandle,
    followup_id: String,
) -> Result<Vec<FollowupEvent>, String> {
    let pool = app.state::<SqlitePool>();
    sqlx::query_as::<_, FollowupEvent>(AssertSqlSafe(format!(
        "SELECT {FOLLOWUP_EVENT_COLUMNS} FROM followup_events
         WHERE followup_id = ? ORDER BY occurred_at ASC, id ASC"
    )))
    .bind(&followup_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| {
        log::error!("Failed to list events for follow-up {followup_id}: {e}");
        format!("Failed to list follow-up history: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_followup_events_for_job(
    app: AppHandle,
    job_id: String,
) -> Result<Vec<FollowupEvent>, String> {
    let pool = app.state::<SqlitePool>();
    list_followup_events_for_job_with_pool(pool.inner(), &job_id).await
}

async fn list_followup_events_for_job_with_pool(
    pool: &SqlitePool,
    job_id: &str,
) -> Result<Vec<FollowupEvent>, String> {
    sqlx::query_as::<_, FollowupEvent>(
        "SELECT e.id, e.followup_id, e.from_status, e.to_status, e.reason, e.occurred_at
         FROM followup_events e
         INNER JOIN followups f ON f.id = e.followup_id
         WHERE f.job_id = ?
         ORDER BY e.occurred_at ASC, e.id ASC",
    )
    .bind(job_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to list follow-up history for job {job_id}: {e}");
        format!("Failed to list follow-up history: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn create_followup(
    app: AppHandle,
    input: CreateFollowupInput,
) -> Result<Followup, String> {
    let pool = app.state::<SqlitePool>();
    create_followup_with_pool(pool.inner(), input).await
}

async fn create_followup_with_pool(
    pool: &SqlitePool,
    input: CreateFollowupInput,
) -> Result<Followup, String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM followups
         WHERE job_id = ?
           AND status IN ('pending', 'draft_ready', 'send_unknown')
         LIMIT 1",
    )
    .bind(&input.job_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to inspect active follow-ups: {e}"))?;
    if existing.is_some() {
        return Err(
            "An active follow-up already exists for this job. Resolve or skip it before creating another."
                .to_string(),
        );
    }

    let id = uuid::Uuid::now_v7().to_string();

    sqlx::query(
        "INSERT INTO followups (id, job_id, status, scheduled_date, recipient_email) VALUES (?, ?, 'pending', ?, ?)",
    )
    .bind(&id)
    .bind(&input.job_id)
    .bind(&input.scheduled_date)
    .bind(&input.recipient_email)
    .execute(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to create followup: {e}");
        if e.to_string()
            .contains("active follow-up already exists for this job")
        {
            "An active follow-up already exists for this job. Resolve or skip it before creating another."
                .to_string()
        } else {
            format!("Failed to create followup: {e}")
        }
    })?;

    sqlx::query_as::<_, Followup>(AssertSqlSafe(format!(
        "SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE id = ?"
    )))
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to retrieve created followup: {e}");
        format!("Followup created but could not be retrieved: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn update_followup(
    app: AppHandle,
    id: String,
    input: UpdateFollowupInput,
) -> Result<Followup, String> {
    let pool = app.state::<SqlitePool>();
    update_followup_with_pool(pool.inner(), &id, input).await
}

async fn update_followup_with_pool(
    pool: &SqlitePool,
    id: &str,
    input: UpdateFollowupInput,
) -> Result<Followup, String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin follow-up update: {e}"))?;
    let current = sqlx::query_as::<_, Followup>(AssertSqlSafe(format!(
        "SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE id = ?"
    )))
    .bind(id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|e| format!("Failed to get followup: {e}"))?
    .ok_or_else(|| "Followup not found".to_string())?;

    let is_empty = input.draft_subject.is_none()
        && input.draft_body.is_none()
        && input.status.is_none()
        && input.scheduled_date.is_none()
        && input.sent_at.is_none()
        && input.gmail_message_id.is_none()
        && input.recipient_email.is_none()
        && input.transition_reason.is_none();
    if is_empty {
        transaction
            .commit()
            .await
            .map_err(|e| format!("Failed to finish follow-up lookup: {e}"))?;
        return Ok(current);
    }

    let target_status = input
        .status
        .clone()
        .unwrap_or_else(|| current.status.clone());
    validate_followup_transition(&current.status, &target_status)?;
    validate_transition_reason(
        &current.status,
        &target_status,
        input.transition_reason.as_deref(),
    )?;
    validate_followup_state(
        &target_status,
        input
            .draft_subject
            .as_deref()
            .or(current.draft_subject.as_deref()),
        input
            .draft_body
            .as_deref()
            .or(current.draft_body.as_deref()),
        input
            .recipient_email
            .as_deref()
            .or(current.recipient_email.as_deref()),
        input.sent_at.as_deref().or(current.sent_at.as_deref()),
    )?;

    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();

    maybe_set!(input, set_clauses, values, draft_subject, "draft_subject");
    maybe_set!(input, set_clauses, values, draft_body, "draft_body");
    maybe_set!(input, set_clauses, values, status, "status");
    maybe_set!(input, set_clauses, values, scheduled_date, "scheduled_date");
    maybe_set!(input, set_clauses, values, sent_at, "sent_at");
    maybe_set!(
        input,
        set_clauses,
        values,
        gmail_message_id,
        "gmail_message_id"
    );
    maybe_set!(
        input,
        set_clauses,
        values,
        recipient_email,
        "recipient_email"
    );

    // Column fragments come only from the literal allowlist in maybe_set!; values stay bound.
    let sql = format!(
        "UPDATE followups SET {} WHERE id = ?",
        set_clauses.join(", ")
    );
    let mut query = sqlx::query(AssertSqlSafe(sql));
    for val in &values {
        query = query.bind(val);
    }
    query = query.bind(id);

    let result = query.execute(&mut *transaction).await.map_err(|e| {
        log::error!("Failed to update followup {id}: {e}");
        format!("Failed to update followup: {e}")
    })?;

    if result.rows_affected() == 0 {
        return Err("Followup not found".to_string());
    }

    if current.status != target_status {
        sqlx::query(
            "INSERT INTO followup_events (
                id, followup_id, from_status, to_status, reason
             ) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::now_v7().to_string())
        .bind(id)
        .bind(&current.status)
        .bind(&target_status)
        .bind(
            input
                .transition_reason
                .as_deref()
                .expect("validated status transition must have a reason"),
        )
        .execute(&mut *transaction)
        .await
        .map_err(|e| {
            log::error!("Failed to record follow-up history for {id}: {e}");
            format!("Failed to record follow-up history: {e}")
        })?;
    }

    let updated = sqlx::query_as::<_, Followup>(AssertSqlSafe(format!(
        "SELECT {FOLLOWUP_COLUMNS} FROM followups WHERE id = ?"
    )))
    .bind(id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|e| format!("Followup updated but could not be retrieved: {e}"))?;
    transaction
        .commit()
        .await
        .map_err(|e| format!("Failed to commit follow-up update: {e}"))?;
    Ok(updated)
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn update_input(
        status: &str,
        sent_at: Option<&str>,
        transition_reason: Option<&str>,
    ) -> UpdateFollowupInput {
        UpdateFollowupInput {
            draft_subject: None,
            draft_body: None,
            status: Some(status.to_string()),
            scheduled_date: None,
            sent_at: sent_at.map(str::to_string),
            gmail_message_id: None,
            recipient_email: None,
            transition_reason: transition_reason.map(str::to_string),
        }
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("database");
        sqlx::query(
            "CREATE TABLE followups (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                draft_subject TEXT,
                draft_body TEXT,
                status TEXT NOT NULL,
                scheduled_date TEXT NOT NULL,
                sent_at TEXT,
                gmail_message_id TEXT,
                recipient_email TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE followup_events (
                id TEXT PRIMARY KEY,
                followup_id TEXT NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
                from_status TEXT,
                to_status TEXT NOT NULL,
                reason TEXT NOT NULL,
                occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
        )
        .execute(&pool)
        .await
        .expect("followups table");
        pool
    }

    #[test]
    fn create_rejects_a_second_active_followup_but_allows_one_after_resolution() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date)
                 VALUES ('existing', 'job-1', 'send_unknown', '2026-07-18')",
            )
            .execute(&pool)
            .await
            .expect("existing active followup");
            let input = CreateFollowupInput {
                job_id: "job-1".to_string(),
                scheduled_date: "2026-07-20".to_string(),
                recipient_email: None,
            };

            let error = create_followup_with_pool(&pool, input.clone())
                .await
                .expect_err("duplicate active followup must fail");
            assert!(error.contains("active follow-up already exists"));

            sqlx::query("UPDATE followups SET status = 'skipped' WHERE id = 'existing'")
                .execute(&pool)
                .await
                .expect("resolve existing followup");
            let created = create_followup_with_pool(&pool, input)
                .await
                .expect("new followup after resolution");
            assert_eq!(created.status, "pending");
        });
    }

    #[test]
    fn accepts_every_supported_followup_lifecycle_status() {
        for status in ["pending", "draft_ready", "send_unknown", "sent", "skipped"] {
            assert_eq!(validate_followup_status(status), Ok(()));
        }
    }

    #[test]
    fn job_history_read_filters_and_orders_events_in_one_query() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "INSERT INTO followups (id, job_id, status, scheduled_date) VALUES
                 ('followup-a', 'job-1', 'sent', '2026-07-18'),
                 ('followup-b', 'job-1', 'skipped', '2026-07-19'),
                 ('followup-other', 'job-2', 'sent', '2026-07-20')",
            )
            .execute(&pool)
            .await
            .expect("seed followups");
            sqlx::query(
                "INSERT INTO followup_events (
                    id, followup_id, from_status, to_status, reason, occurred_at
                 ) VALUES
                 ('event-c', 'followup-b', 'pending', 'skipped', 'operator_skipped', '2026-07-17T12:00:00Z'),
                 ('event-b', 'followup-a', 'send_unknown', 'sent', 'gmail_accepted', '2026-07-17T12:00:00Z'),
                 ('event-a', 'followup-a', 'draft_ready', 'send_unknown', 'send_attempted', '2026-07-17T11:00:00Z'),
                 ('event-other', 'followup-other', 'send_unknown', 'sent', 'gmail_accepted', '2026-07-17T10:00:00Z')",
            )
            .execute(&pool)
            .await
            .expect("seed events");

            let history = list_followup_events_for_job_with_pool(&pool, "job-1")
                .await
                .expect("job history");

            assert_eq!(
                history
                    .iter()
                    .map(|event| event.id.as_str())
                    .collect::<Vec<_>>(),
                vec!["event-a", "event-b", "event-c"]
            );
            assert!(history
                .iter()
                .all(|event| event.followup_id != "followup-other"));
        });
    }

    #[test]
    fn rejects_values_outside_the_followup_lifecycle_contract() {
        for status in [
            "",
            "pending ",
            "SENT",
            "sending",
            "unknown_outcome",
            "failed",
        ] {
            let error = validate_followup_status(status).expect_err("unsupported status must fail");
            assert!(
                error.starts_with("Unsupported follow-up status:"),
                "unexpected validation error: {error}"
            );
            assert!(
                error.contains("pending, draft_ready, send_unknown, sent, skipped"),
                "error must explain the accepted contract: {error}"
            );
        }
    }

    #[test]
    fn accepts_only_supported_followup_transitions() {
        for (from, to) in [
            ("pending", "pending"),
            ("pending", "draft_ready"),
            ("pending", "send_unknown"),
            ("pending", "skipped"),
            ("draft_ready", "draft_ready"),
            ("draft_ready", "send_unknown"),
            ("draft_ready", "skipped"),
            ("send_unknown", "send_unknown"),
            ("send_unknown", "sent"),
            ("send_unknown", "draft_ready"),
            ("sent", "sent"),
            ("skipped", "skipped"),
        ] {
            assert_eq!(
                validate_followup_transition(from, to),
                Ok(()),
                "{from} -> {to} must remain supported"
            );
        }
    }

    #[test]
    fn rejects_reopening_or_bypassing_followup_transitions() {
        for (from, to) in [
            ("pending", "sent"),
            ("draft_ready", "pending"),
            ("draft_ready", "sent"),
            ("send_unknown", "pending"),
            ("send_unknown", "skipped"),
            ("sent", "draft_ready"),
            ("sent", "send_unknown"),
            ("skipped", "pending"),
            ("skipped", "draft_ready"),
        ] {
            let error = validate_followup_transition(from, to)
                .expect_err("unsupported transition must fail");
            assert!(
                error.starts_with("Unsupported follow-up transition:"),
                "unexpected transition error: {error}"
            );
        }
    }

    #[test]
    fn active_send_states_require_complete_merged_fields() {
        assert!(
            validate_followup_state("draft_ready", Some("Subject"), Some("Body"), None, None,)
                .is_ok()
        );
        assert!(
            validate_followup_state("draft_ready", Some(" "), Some("Body"), None, None,).is_err()
        );
        assert!(validate_followup_state(
            "send_unknown",
            Some("Subject"),
            Some("Body"),
            Some("recruiter@example.invalid"),
            None,
        )
        .is_ok());
        assert!(
            validate_followup_state("send_unknown", Some("Subject"), Some("Body"), None, None,)
                .is_err()
        );
        assert!(validate_followup_state(
            "sent",
            Some("Subject"),
            Some("Body"),
            Some("recruiter@example.invalid"),
            Some("2026-07-17T12:00:00Z"),
        )
        .is_ok());
        assert!(validate_followup_state(
            "sent",
            Some("Subject"),
            Some("Body"),
            Some("recruiter@example.invalid"),
            None,
        )
        .is_err());
    }

    #[test]
    fn rejected_transition_or_invariant_rolls_back_without_partial_state() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "INSERT INTO followups (
                    id, job_id, draft_subject, draft_body, status,
                    scheduled_date, recipient_email, created_at
                ) VALUES (
                    'followup-1', 'job-1', 'Subject', 'Body', 'draft_ready',
                    '2026-07-18', 'recruiter@example.invalid',
                    '2026-07-17T00:00:00Z'
                )",
            )
            .execute(&pool)
            .await
            .expect("seed followup");

            let missing_reason = update_followup_with_pool(
                &pool,
                "followup-1",
                update_input("send_unknown", None, None),
            )
            .await
            .expect_err("status transition without reason must fail");
            assert!(missing_reason.contains("compatible transition reason"));
            let status: String =
                sqlx::query_scalar("SELECT status FROM followups WHERE id = 'followup-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("status after missing reason");
            assert_eq!(status, "draft_ready");

            let unknown = update_followup_with_pool(
                &pool,
                "followup-1",
                update_input("send_unknown", None, Some("send_attempted")),
            )
            .await
            .expect("durable send marker");
            assert_eq!(unknown.status, "send_unknown");

            let recorded_reason: String = sqlx::query_scalar(
                "SELECT reason FROM followup_events WHERE followup_id = 'followup-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("send attempt history");
            assert_eq!(recorded_reason, "send_attempted");

            let missing_receipt = update_followup_with_pool(
                &pool,
                "followup-1",
                update_input("sent", None, Some("gmail_accepted")),
            )
            .await
            .expect_err("sent without timestamp must fail");
            assert!(missing_receipt.contains("sent_at"));

            let status: String =
                sqlx::query_scalar("SELECT status FROM followups WHERE id = 'followup-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("status after rejected receipt");
            assert_eq!(status, "send_unknown");

            let sent = update_followup_with_pool(
                &pool,
                "followup-1",
                update_input("sent", Some("2026-07-17T12:00:00Z"), Some("gmail_accepted")),
            )
            .await
            .expect("sent receipt");
            assert_eq!(sent.status, "sent");

            let history: Vec<(String, String, String)> = sqlx::query_as(
                "SELECT from_status, to_status, reason
                 FROM followup_events WHERE followup_id = 'followup-1'
                 ORDER BY occurred_at, id",
            )
            .fetch_all(&pool)
            .await
            .expect("follow-up history");
            assert_eq!(
                history,
                vec![
                    (
                        "draft_ready".to_string(),
                        "send_unknown".to_string(),
                        "send_attempted".to_string(),
                    ),
                    (
                        "send_unknown".to_string(),
                        "sent".to_string(),
                        "gmail_accepted".to_string(),
                    ),
                ]
            );

            update_followup_with_pool(
                &pool,
                "followup-1",
                update_input("draft_ready", None, Some("operator_verified_not_sent")),
            )
            .await
            .expect_err("terminal sent state must not reopen");

            let final_status: String =
                sqlx::query_scalar("SELECT status FROM followups WHERE id = 'followup-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("final status");
            assert_eq!(final_status, "sent");
        });
    }

    #[test]
    fn history_write_failure_rolls_back_the_status_change() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "INSERT INTO followups (
                    id, job_id, draft_subject, draft_body, status,
                    scheduled_date, recipient_email
                ) VALUES (
                    'followup-1', 'job-1', 'Subject', 'Body', 'draft_ready',
                    '2026-07-18', 'recruiter@example.invalid'
                )",
            )
            .execute(&pool)
            .await
            .expect("seed followup");
            sqlx::query("DROP TABLE followup_events")
                .execute(&pool)
                .await
                .expect("inject history storage failure");

            let error = update_followup_with_pool(
                &pool,
                "followup-1",
                update_input("send_unknown", None, Some("send_attempted")),
            )
            .await
            .expect_err("history failure must reject the whole transition");
            assert!(error.contains("Failed to record follow-up history"));

            let status: String =
                sqlx::query_scalar("SELECT status FROM followups WHERE id = 'followup-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("status after rolled-back history failure");
            assert_eq!(status, "draft_ready");
        });
    }
}
