//! Import a Verified Application Packet (VAP) produced by ApplyKit.
//!
//! JCC is the downstream consumer of the `vap/1` manifest contract (see
//! ApplyKit `docs/vap-manifest-v1.md`). This module reads a `packet.manifest.json`,
//! refuses unknown schema versions, re-hashes every listed artifact to detect a
//! packet edited after generation (STALE), and creates a tracked job carrying the
//! packet's identity, version, and truth status.
//!
//! SAFETY: importing a packet ONLY writes to the `jobs` table. It never contacts
//! the submission sidecar. A verified packet still enters the normal tracker and
//! must pass the human confirmation in the Submit Console before anything is sent.
//! "Verified" describes the packet's provenance, never an authorization to submit.

use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::types::Job;

/// The only schema version this build understands. Anything else is refused.
const SUPPORTED_SCHEMA: &str = "vap/1";

/// Truth status recorded on the imported job.
pub const STATUS_VERIFIED: &str = "verified";
pub const STATUS_STALE: &str = "stale";
pub const STATUS_UNVERIFIED: &str = "unverified";

// --- vap/1 manifest (consumer-side deserialization view) --------------------
// Only the fields JCC reads are modeled; serde ignores the rest (generator,
// fit, signature, etc.), so the contract can grow without breaking import.

#[derive(Debug, Clone, Deserialize)]
struct VapManifest {
    schema_version: String,
    packet_id: String,
    source: ManifestSource,
    truth: ManifestTruth,
    artifacts: Vec<ManifestArtifact>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestSource {
    company: String,
    role: String,
    source_platform: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestTruth {
    passed: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestArtifact {
    role: String,
    path: String,
    sha256: String,
}

/// Outcome of verifying a manifest against its on-disk artifacts, before any DB
/// write. Pure product of the filesystem; safe to compute and show as a preview.
#[derive(Debug, Clone)]
pub struct VerifiedPacket {
    pub packet_id: String,
    pub schema_version: String,
    pub company: String,
    pub role: String,
    pub source_platform: String,
    pub truth_status: String,
    pub stale_artifacts: Vec<String>,
    pub resume_path: Option<String>,
    pub cover_letter_path: Option<String>,
}

/// Lowercase hex SHA-256, matching ApplyKit's artifact hashing.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Read and verify a `packet.manifest.json`. Refuses unknown schema versions;
/// otherwise re-hashes every artifact to classify the packet's truth status.
pub fn verify_manifest(manifest_path: &Path) -> Result<VerifiedPacket, String> {
    let raw = std::fs::read_to_string(manifest_path)
        .map_err(|e| format!("Failed to read manifest {}: {e}", manifest_path.display()))?;
    let manifest: VapManifest =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse packet manifest: {e}"))?;

    // Hard schema gate: refuse rather than best-effort parse an unknown version.
    if manifest.schema_version != SUPPORTED_SCHEMA {
        return Err(format!(
            "Unsupported packet schema '{}'; this build understands '{SUPPORTED_SCHEMA}'",
            manifest.schema_version
        ));
    }

    let packet_dir = manifest_path
        .parent()
        .ok_or_else(|| "Manifest path has no parent directory".to_string())?;

    // Re-hash each artifact; a mismatch or missing file means STALE (edited after
    // generation). This is the integrity check the "verified" badge rests on.
    let mut stale_artifacts = Vec::new();
    for artifact in &manifest.artifacts {
        let path = packet_dir.join(&artifact.path);
        match std::fs::read(&path) {
            Ok(bytes) if sha256_hex(&bytes) == artifact.sha256 => {}
            _ => stale_artifacts.push(artifact.path.clone()),
        }
    }

    let truth_status = if !stale_artifacts.is_empty() {
        STATUS_STALE
    } else if manifest.truth.passed {
        STATUS_VERIFIED
    } else {
        STATUS_UNVERIFIED
    };

    let resolve = |role: &str| {
        manifest
            .artifacts
            .iter()
            .find(|a| a.role == role)
            .map(|a| packet_dir.join(&a.path).to_string_lossy().to_string())
    };
    let resume_path = resolve("resume_1pg").or_else(|| resolve("resume_2pg"));
    let cover_letter_path = resolve("cover_note");

    Ok(VerifiedPacket {
        packet_id: manifest.packet_id,
        schema_version: manifest.schema_version,
        company: manifest.source.company,
        role: manifest.source.role,
        source_platform: manifest.source.source_platform,
        truth_status: truth_status.to_string(),
        stale_artifacts,
        resume_path,
        cover_letter_path,
    })
}

/// Insert a tracked job from a verified packet and return its id. Writes only to
/// `jobs`; never triggers a submission.
async fn insert_job_from_packet(
    pool: &SqlitePool,
    verified: &VerifiedPacket,
    apply_url: &str,
    ats: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO jobs (id, company, role, ats, apply_url, source, resume_path, cover_letter_path, source_packet_id, source_packet_version, truth_status) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&verified.company)
    .bind(&verified.role)
    .bind(ats)
    .bind(apply_url)
    .bind(&verified.source_platform)
    .bind(&verified.resume_path)
    .bind(&verified.cover_letter_path)
    .bind(&verified.packet_id)
    .bind(&verified.schema_version)
    .bind(&verified.truth_status)
    .execute(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to insert imported packet job: {e}");
        format!("Failed to import packet: {e}")
    })?;
    Ok(id)
}

async fn fetch_job(pool: &SqlitePool, id: &str) -> Result<Job, String> {
    sqlx::query_as::<_, Job>(
        "SELECT id, company, role, ats, apply_url, job_posting_id, board_token, status, tier, source, resume_path, cover_letter_path, custom_fields, notes, applied_at, follow_up_date, response_date, salary_range, location, jd_url, source_packet_id, source_packet_version, truth_status, created_at, updated_at FROM jobs WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to load imported job: {e}"))?
    .ok_or_else(|| "Imported job could not be retrieved".to_string())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct ImportPacketInput {
    /// Absolute path to the packet's `packet.manifest.json`.
    pub manifest_path: String,
    /// The posting URL the human is applying to (the packet does not carry it).
    pub apply_url: String,
    /// ATS identifier for the posting (e.g. `ashby`, `greenhouse`, `linkedin`).
    pub ats: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct ImportPacketResult {
    pub job: Job,
    pub packet_id: String,
    pub truth_status: String,
    pub stale_artifacts: Vec<String>,
}

/// Verify a VAP manifest and import it as a tracked job. Never submits.
#[tauri::command]
#[specta::specta]
pub async fn import_packet(
    app: AppHandle,
    input: ImportPacketInput,
) -> Result<ImportPacketResult, String> {
    let verified = verify_manifest(Path::new(&input.manifest_path))?;
    let pool = app.state::<SqlitePool>();
    let id = insert_job_from_packet(pool.inner(), &verified, &input.apply_url, &input.ats).await?;
    let job = fetch_job(pool.inner(), &id).await?;
    Ok(ImportPacketResult {
        job,
        packet_id: verified.packet_id,
        truth_status: verified.truth_status,
        stale_artifacts: verified.stale_artifacts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::PathBuf;

    /// Minimal jobs table matching the columns import writes + reads.
    const TEST_JOBS_DDL: &str = "CREATE TABLE jobs (
        id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, ats TEXT NOT NULL,
        apply_url TEXT NOT NULL, job_posting_id TEXT, board_token TEXT,
        status TEXT NOT NULL DEFAULT 'saved', tier TEXT NOT NULL DEFAULT 'tier1',
        source TEXT DEFAULT 'Company careers page', resume_path TEXT, cover_letter_path TEXT,
        custom_fields TEXT DEFAULT '{}', notes TEXT DEFAULT '', applied_at TEXT,
        follow_up_date TEXT, response_date TEXT, salary_range TEXT, location TEXT, jd_url TEXT,
        source_packet_id TEXT, source_packet_version TEXT, truth_status TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );";

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory pool");
        sqlx::query(TEST_JOBS_DDL)
            .execute(&pool)
            .await
            .expect("create jobs");
        pool
    }

    /// Write a packet dir with one resume + a manifest referencing it by true hash.
    fn write_packet(dir: &Path, resume_body: &str, passed: bool) -> PathBuf {
        let resume = dir.join("Resume_1pg_Tailored.md");
        std::fs::write(&resume, resume_body).expect("write resume");
        let manifest = serde_json::json!({
            "schema_version": "vap/1",
            "packet_id": "sha256:abc123",
            "source": { "company": "Acme", "role": "Senior Engineer", "source_platform": "LinkedIn" },
            "truth": { "passed": passed },
            "artifacts": [
                { "role": "resume_1pg", "path": "Resume_1pg_Tailored.md",
                  "sha256": sha256_hex(resume_body.as_bytes()), "format": "md" }
            ]
        });
        let manifest_path = dir.join("packet.manifest.json");
        std::fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .expect("write manifest");
        manifest_path
    }

    #[test]
    fn verify_intact_packet_is_verified() {
        let dir = tempfile::tempdir().expect("tmp");
        let manifest_path = write_packet(dir.path(), "original resume", true);
        let v = verify_manifest(&manifest_path).expect("verify");
        assert_eq!(v.truth_status, STATUS_VERIFIED);
        assert!(v.stale_artifacts.is_empty());
        assert_eq!(v.company, "Acme");
        assert!(v.resume_path.is_some());
    }

    #[test]
    fn verify_detects_edited_artifact_as_stale() {
        let dir = tempfile::tempdir().expect("tmp");
        let manifest_path = write_packet(dir.path(), "original resume", true);
        // Edit the resume after the manifest was written.
        std::fs::write(dir.path().join("Resume_1pg_Tailored.md"), "EDITED").expect("tamper");
        let v = verify_manifest(&manifest_path).expect("verify");
        assert_eq!(v.truth_status, STATUS_STALE);
        assert_eq!(
            v.stale_artifacts,
            vec!["Resume_1pg_Tailored.md".to_string()]
        );
    }

    #[test]
    fn verify_refuses_unknown_schema_version() {
        let dir = tempfile::tempdir().expect("tmp");
        let manifest = serde_json::json!({
            "schema_version": "vap/99",
            "packet_id": "sha256:x",
            "source": { "company": "A", "role": "B", "source_platform": "C" },
            "truth": { "passed": true },
            "artifacts": []
        });
        let manifest_path = dir.path().join("packet.manifest.json");
        std::fs::write(&manifest_path, manifest.to_string()).expect("write");
        let err = verify_manifest(&manifest_path).unwrap_err();
        assert!(err.contains("Unsupported packet schema"), "got: {err}");
    }

    #[test]
    fn import_creates_job_with_provenance_and_never_submits() {
        // Manual current-thread runtime: tokio's `rt` is feature-unified in via
        // sqlx's runtime-tokio, avoiding a dependency on the tokio test macro.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        rt.block_on(async {
            let dir = tempfile::tempdir().expect("tmp");
            let manifest_path = write_packet(dir.path(), "resume body", true);
            let verified = verify_manifest(&manifest_path).expect("verify");

            let pool = test_pool().await;
            let id = insert_job_from_packet(
                &pool,
                &verified,
                "https://boards.example/apply",
                "greenhouse",
            )
            .await
            .expect("import");
            let job = fetch_job(&pool, &id).await.expect("fetch");

            assert_eq!(job.company, "Acme");
            assert_eq!(job.ats, "greenhouse");
            assert_eq!(job.apply_url, "https://boards.example/apply");
            assert_eq!(job.truth_status.as_deref(), Some(STATUS_VERIFIED));
            assert_eq!(job.source_packet_version.as_deref(), Some("vap/1"));
            assert_eq!(job.source_packet_id.as_deref(), Some("sha256:abc123"));
            // Default status is the tracker's entry column, NOT anything submitted.
            assert_eq!(job.status, "saved");
            assert!(job.resume_path.is_some());
        });
    }
}
