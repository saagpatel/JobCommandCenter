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

use std::collections::BTreeMap;
use std::path::Path;

use ring::signature::{UnparsedPublicKey, ED25519};
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
    #[serde(default)]
    custom_fields: BTreeMap<String, String>,
    #[serde(default)]
    signature: Option<ManifestSignature>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestSignature {
    alg: String,
    /// Hex of the 32-byte Ed25519 public key.
    public_key: String,
    /// SHA-256 fingerprint of `public_key`.
    public_key_id: String,
    /// Hex of the 64-byte signature over the signing payload.
    signature: String,
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
    /// True when a valid Ed25519 signature was present and verified.
    pub signed: bool,
    /// Signing key fingerprint, if the manifest carried a signature block.
    pub public_key_id: Option<String>,
    pub resume_path: Option<String>,
    pub cover_letter_path: Option<String>,
    /// Signed, operator-supplied ATS answers to persist with the imported job.
    pub custom_fields: BTreeMap<String, String>,
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

fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.trim();
    if s.len() % 2 != 0 {
        return Err("odd-length hex string".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

/// Reconstruct the exact bytes ApplyKit's Ed25519 signature covers. MUST byte-match
/// ApplyKit's `manifest::signing_payload`: schema + packet_id + sorted artifact
/// hashes + truth verdict, newline-joined. See ApplyKit docs/vap-manifest-v1.md.
fn signing_payload(manifest: &VapManifest) -> Vec<u8> {
    let mut lines = vec![
        format!("schema={}", manifest.schema_version),
        format!("packet_id={}", manifest.packet_id),
    ];
    let mut artifact_lines: Vec<String> = manifest
        .artifacts
        .iter()
        .map(|a| format!("artifact\0{}\0{}", a.path, a.sha256))
        .collect();
    artifact_lines.sort();
    lines.extend(artifact_lines);
    for (key, value) in &manifest.custom_fields {
        lines.push(format!("custom_field\0{key}\0{value}"));
    }
    lines.push(format!("truth_passed={}", manifest.truth.passed));
    lines.join("\n").into_bytes()
}

/// Verify a manifest's embedded Ed25519 signature over [`signing_payload`].
/// True only if the block is present, well-formed, its fingerprint matches the
/// embedded key, and the signature validates. Proves integrity; pin
/// `public_key_id` to also assert provenance.
fn verify_signature(manifest: &VapManifest) -> bool {
    let Some(block) = &manifest.signature else {
        return false;
    };
    if block.alg != "ed25519" {
        return false;
    }
    let Ok(public_key) = from_hex(&block.public_key) else {
        return false;
    };
    if sha256_hex(&public_key) != block.public_key_id {
        return false;
    }
    let Ok(signature) = from_hex(&block.signature) else {
        return false;
    };
    UnparsedPublicKey::new(&ED25519, &public_key)
        .verify(&signing_payload(manifest), &signature)
        .is_ok()
}

/// Read and verify a `packet.manifest.json`. Refuses unknown schema versions and,
/// when `expected_public_key_id` is set, packets not signed by that trusted key.
/// Re-hashes every artifact and verifies the Ed25519 signature to classify status.
///
/// `truth_status`: `verified` requires a valid signature, intact artifacts, and a
/// passing truth gate. On-disk edits are `stale` (re-run ApplyKit); an absent or
/// invalid signature, or a non-passing gate, is `unverified`.
pub fn verify_manifest(
    manifest_path: &Path,
    expected_public_key_id: Option<&str>,
) -> Result<VerifiedPacket, String> {
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

    // Provenance pin: if the caller trusts a specific signing key, refuse any
    // packet not signed by exactly that key before doing anything else.
    if let Some(expected) = expected_public_key_id {
        let matches = manifest
            .signature
            .as_ref()
            .is_some_and(|b| b.public_key_id == expected);
        if !matches {
            return Err(format!(
                "Packet is not signed by the trusted key (expected {expected})"
            ));
        }
    }

    let packet_dir = manifest_path
        .parent()
        .ok_or_else(|| "Manifest path has no parent directory".to_string())?;

    // Re-hash each artifact; a mismatch or missing file means STALE (edited after
    // generation). This is the on-disk integrity check.
    let mut stale_artifacts = Vec::new();
    for artifact in &manifest.artifacts {
        let path = packet_dir.join(&artifact.path);
        match std::fs::read(&path) {
            Ok(bytes) if sha256_hex(&bytes) == artifact.sha256 => {}
            _ => stale_artifacts.push(artifact.path.clone()),
        }
    }

    // Cryptographic proof that the manifest (and thus its artifact hashes and
    // verdict) is authentic and unaltered.
    let signature_valid = verify_signature(&manifest);

    let truth_status = if !stale_artifacts.is_empty() {
        STATUS_STALE
    } else if signature_valid && manifest.truth.passed {
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
    let public_key_id = manifest.signature.as_ref().map(|b| b.public_key_id.clone());

    Ok(VerifiedPacket {
        packet_id: manifest.packet_id,
        schema_version: manifest.schema_version,
        company: manifest.source.company,
        role: manifest.source.role,
        source_platform: manifest.source.source_platform,
        truth_status: truth_status.to_string(),
        stale_artifacts,
        signed: signature_valid,
        public_key_id,
        resume_path,
        cover_letter_path,
        custom_fields: manifest.custom_fields,
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
    let custom_fields = serde_json::to_string(&verified.custom_fields)
        .map_err(|e| format!("Failed to serialize packet custom fields: {e}"))?;
    sqlx::query(
        "INSERT INTO jobs (id, company, role, ats, apply_url, source, resume_path, cover_letter_path, custom_fields, source_packet_id, source_packet_version, truth_status) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&verified.company)
    .bind(&verified.role)
    .bind(ats)
    .bind(apply_url)
    .bind(&verified.source_platform)
    .bind(&verified.resume_path)
    .bind(&verified.cover_letter_path)
    .bind(&custom_fields)
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
    /// Optional trusted signing-key fingerprint. When set, packets not signed by
    /// exactly this key are refused (provenance pinning).
    pub expected_public_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct ImportPacketResult {
    pub job: Job,
    pub packet_id: String,
    pub truth_status: String,
    pub stale_artifacts: Vec<String>,
    /// True when a valid Ed25519 signature was present and verified.
    pub signed: bool,
    /// Signing key fingerprint, if the manifest carried a signature.
    pub public_key_id: Option<String>,
}

/// Verify a VAP manifest and import it as a tracked job. Never submits.
#[tauri::command]
#[specta::specta]
pub async fn import_packet(
    app: AppHandle,
    input: ImportPacketInput,
) -> Result<ImportPacketResult, String> {
    let verified = verify_manifest(
        Path::new(&input.manifest_path),
        input.expected_public_key_id.as_deref(),
    )?;
    let pool = app.state::<SqlitePool>();
    let id = insert_job_from_packet(pool.inner(), &verified, &input.apply_url, &input.ats).await?;
    let job = fetch_job(pool.inner(), &id).await?;
    Ok(ImportPacketResult {
        job,
        packet_id: verified.packet_id,
        truth_status: verified.truth_status,
        stale_artifacts: verified.stale_artifacts,
        signed: verified.signed,
        public_key_id: verified.public_key_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::PathBuf;

    const TEST_SEED: [u8; 32] = [7u8; 32];

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn test_keypair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&TEST_SEED).expect("keypair")
    }

    fn manifest_value(resume_body: &str, passed: bool) -> serde_json::Value {
        serde_json::json!({
            "schema_version": "vap/1",
            "packet_id": "sha256:abc123",
            "source": { "company": "Acme", "role": "Senior Engineer", "source_platform": "LinkedIn" },
            "truth": { "passed": passed },
            "artifacts": [
                { "role": "resume_1pg", "path": "Resume_1pg_Tailored.md",
                  "sha256": sha256_hex(resume_body.as_bytes()), "format": "md" }
            ]
        })
    }

    /// Add a valid signature block (test key) to a manifest value; returns the
    /// key fingerprint. Signs over the production `signing_payload`, proving the
    /// ApplyKit (ed25519-dalek) and JCC (ring) payloads interoperate.
    fn sign_manifest_value(value: &mut serde_json::Value) -> String {
        let manifest: VapManifest = serde_json::from_value(value.clone()).expect("parse to sign");
        let payload = signing_payload(&manifest);
        let keypair = test_keypair();
        let public_key = keypair.public_key().as_ref().to_vec();
        let signature = keypair.sign(&payload);
        let public_key_id = sha256_hex(&public_key);
        value["signature"] = serde_json::json!({
            "alg": "ed25519",
            "public_key": to_hex(&public_key),
            "public_key_id": public_key_id,
            "signature": to_hex(signature.as_ref()),
        });
        public_key_id
    }

    fn write_manifest(dir: &Path, value: &serde_json::Value) -> PathBuf {
        let path = dir.join("packet.manifest.json");
        std::fs::write(&path, serde_json::to_string_pretty(value).unwrap())
            .expect("write manifest");
        path
    }

    /// Write a signed packet dir; returns (manifest_path, key fingerprint).
    fn write_signed_packet(dir: &Path, resume_body: &str, passed: bool) -> (PathBuf, String) {
        std::fs::write(dir.join("Resume_1pg_Tailored.md"), resume_body).expect("write resume");
        let mut value = manifest_value(resume_body, passed);
        let public_key_id = sign_manifest_value(&mut value);
        (write_manifest(dir, &value), public_key_id)
    }

    /// Write an unsigned packet dir (no signature block).
    fn write_unsigned_packet(dir: &Path, resume_body: &str) -> PathBuf {
        std::fs::write(dir.join("Resume_1pg_Tailored.md"), resume_body).expect("write resume");
        write_manifest(dir, &manifest_value(resume_body, true))
    }

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

    #[test]
    fn verify_intact_signed_packet_is_verified() {
        let dir = tempfile::tempdir().expect("tmp");
        let (manifest_path, key_id) = write_signed_packet(dir.path(), "original resume", true);
        let v = verify_manifest(&manifest_path, None).expect("verify");
        assert_eq!(v.truth_status, STATUS_VERIFIED);
        assert!(v.signed, "signature must verify");
        assert_eq!(v.public_key_id.as_deref(), Some(key_id.as_str()));
        assert!(v.stale_artifacts.is_empty());
        assert_eq!(v.company, "Acme");
        assert!(v.resume_path.is_some());
    }

    #[test]
    fn verify_unsigned_packet_is_unverified() {
        let dir = tempfile::tempdir().expect("tmp");
        let manifest_path = write_unsigned_packet(dir.path(), "original resume");
        let v = verify_manifest(&manifest_path, None).expect("verify");
        assert_eq!(
            v.truth_status, STATUS_UNVERIFIED,
            "no signature => not verified"
        );
        assert!(!v.signed);
        assert!(v.public_key_id.is_none());
    }

    #[test]
    fn verify_detects_edited_artifact_as_stale() {
        let dir = tempfile::tempdir().expect("tmp");
        let (manifest_path, _) = write_signed_packet(dir.path(), "original resume", true);
        // Edit the resume after the manifest was written (and signed).
        std::fs::write(dir.path().join("Resume_1pg_Tailored.md"), "EDITED").expect("tamper");
        let v = verify_manifest(&manifest_path, None).expect("verify");
        assert_eq!(v.truth_status, STATUS_STALE);
        assert_eq!(
            v.stale_artifacts,
            vec!["Resume_1pg_Tailored.md".to_string()]
        );
    }

    #[test]
    fn verify_tampered_manifest_is_unverified() {
        let dir = tempfile::tempdir().expect("tmp");
        let (manifest_path, _) = write_signed_packet(dir.path(), "resume", true);
        // Tamper a signed identity field on disk WITHOUT touching the artifact,
        // so this isolates signature failure (not staleness).
        let mut value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&manifest_path).unwrap()).unwrap();
        value["packet_id"] = serde_json::json!("sha256:tampered");
        std::fs::write(&manifest_path, value.to_string()).unwrap();

        let v = verify_manifest(&manifest_path, None).expect("verify");
        assert_eq!(
            v.truth_status, STATUS_UNVERIFIED,
            "broken signature => not verified"
        );
        assert!(!v.signed);
        assert!(
            v.stale_artifacts.is_empty(),
            "artifact bytes were untouched"
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
        let manifest_path = write_manifest(dir.path(), &manifest);
        let err = verify_manifest(&manifest_path, None).unwrap_err();
        assert!(err.contains("Unsupported packet schema"), "got: {err}");
    }

    #[test]
    fn verify_enforces_pinned_provenance_key() {
        let dir = tempfile::tempdir().expect("tmp");
        let (manifest_path, key_id) = write_signed_packet(dir.path(), "resume", true);

        // Correct pin verifies.
        let ok = verify_manifest(&manifest_path, Some(&key_id)).expect("verify");
        assert_eq!(ok.truth_status, STATUS_VERIFIED);

        // Wrong pin is refused outright.
        let err = verify_manifest(&manifest_path, Some("sha256:not-the-trusted-key")).unwrap_err();
        assert!(err.contains("trusted key"), "got: {err}");
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
            let (manifest_path, _) = write_signed_packet(dir.path(), "resume body", true);
            let verified = verify_manifest(&manifest_path, None).expect("verify");

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
            assert_eq!(job.custom_fields.as_deref(), Some("{}"));
        });
    }

    #[test]
    fn import_persists_signed_packet_custom_fields() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        rt.block_on(async {
            let dir = tempfile::tempdir().expect("tmp");
            let (manifest_path, _) = write_signed_packet(dir.path(), "resume body", true);
            let mut value: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&manifest_path).unwrap()).unwrap();
            value["custom_fields"] = serde_json::json!({"desired_salary": "180000"});
            let _ = sign_manifest_value(&mut value);
            std::fs::write(
                &manifest_path,
                serde_json::to_string_pretty(&value).unwrap(),
            )
            .unwrap();

            let verified = verify_manifest(&manifest_path, None).expect("verify");
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
            assert_eq!(
                job.custom_fields.as_deref(),
                Some(r#"{"desired_salary":"180000"}"#)
            );
        });
    }
}
