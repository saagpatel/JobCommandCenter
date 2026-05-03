# Job Command Center — Implementation Plan

## 1. EXEC SUMMARY

### What we're building

A Tauri 2 desktop application ("Job Command Center") that centralizes the entire job search pipeline: tracking listings across a Kanban board, batch-submitting applications via API-direct and Playwright automation, managing follow-up emails with Claude-drafted content sent through Gmail, generating interview prep briefs, and visualizing pipeline analytics. The submission engine runs as a Python sidecar (FastAPI on localhost:9876), bundled via PyInstaller, handling Ashby API, Greenhouse API, LinkedIn Easy Apply, Indeed Apply, and generic ATS Playwright automation. Built on a fork of dannysmith/tauri-template (React 19 + TypeScript + shadcn/ui + Zustand + TanStack Query + tauri-specta).

### Riskiest parts & de-risking strategy

1. **HIGH — LinkedIn bot detection blocking Easy Apply automation**
   - WHY: LinkedIn actively detects automated browsers via navigator.webdriver, timing patterns, and behavioral analysis. Account restrictions or bans are possible.
   - MITIGATION: Use `launch_persistent_context()` with a real Chrome channel (not Chromium), human-like delays (2-5s between actions via random jitter), headed mode only, and stealth patches (webdriver flag removal). Rate limit to max 10 Easy Apply submissions per session with 30-60 min cooldown between sessions.
   - FALLBACK: If LinkedIn becomes too aggressive, degrade to "assisted mode" — app opens the listing page, user manually clicks Easy Apply, app just tracks the status update. Never risk account ban.

2. **HIGH — Tauri ↔ Python sidecar lifecycle management**
   - WHY: Spawning, monitoring, and cleanly killing a Python subprocess from Rust is error-prone. Zombie processes, port conflicts, startup race conditions.
   - MITIGATION: FastAPI sidecar starts on a fixed port (9876) with a `/health` endpoint. Rust backend polls health every 5s. If sidecar dies, auto-restart with 3 retry limit. On app quit, send shutdown command to `/shutdown` endpoint, then SIGTERM after 5s grace period. PID file prevents duplicate instances.
   - FALLBACK: If sidecar management is too fragile, switch to stdin/stdout JSON-RPC communication instead of HTTP. Simpler lifecycle, no port management.

3. **MEDIUM — PyInstaller binary size and startup time on macOS ARM**
   - WHY: PyInstaller bundles the entire Python runtime + Playwright + FastAPI + all deps. Can balloon to 200-400MB. Startup time can be 5-10s.
   - MITIGATION: Use `--onefile` mode, exclude unnecessary modules, strip debug symbols. Use PyOxidizer as alternative if PyInstaller is too bloated. Pre-warm the sidecar on app launch (start it in background before user needs it).
   - FALLBACK: Don't bundle Python at all — require Python 3.12+ to be installed on the machine and run the sidecar as a script. Simpler, smaller, but adds a user dependency.

4. **MEDIUM — Ashby form field mapping across different companies**
   - WHY: Each company's Ashby form has different custom fields, different required fields, and different field paths. A field mapper that works for Ramp may fail for Whatnot.
   - MITIGATION: Always fetch the form definition via `jobPosting.info` API before submission. Build a dynamic mapper that matches profile fields to system fields and surfaces unmapped required fields as a "NEEDS INPUT" prompt in the UI.
   - FALLBACK: For forms with > 3 unmapped required fields, flag as "Playwright fallback" and use the browser adapter instead.

5. **LOW — dannysmith/tauri-template AGPL license**
   - WHY: AGPL requires sharing source code if the app is distributed. This is a personal tool, not distributed, so it's irrelevant.
   - MITIGATION: None needed for personal use.
   - FALLBACK: If you ever want to distribute, strip the template code and rewrite from scratch (the patterns are the value, not the code).

### Shortest path to daily personal use

- **Phase 0 (Weeks 1-2):** Tauri app with tracker board + SQLite. Replace the Claude.ai artifact. Solves 30% of the pain (persistent tracking, real database).
- **Phase 1 (Weeks 3-4):** Ashby + Greenhouse API adapters in sidecar. Solves 40% more (automated submission for ~60% of target listings).
- **Phase 2 (Weeks 5-6):** LinkedIn Easy Apply + Indeed. Solves 25% more (Tier 2 volume applications).
- **Phase 3 (Weeks 7-8):** Follow-ups, interview prep, analytics. Solves remaining 5% (pipeline management).

Ship Phase 0 by end of week 2. You immediately stop using the Claude.ai artifact.

---

## 2. REVIEW GATE (SPEC LOCK)

### Goal

One desktop app runs the entire job search pipeline — from saving a listing to submitting the application to sending follow-up emails.

### Success metrics

1. Tracker board loads < 1s with 100+ listings in SQLite
2. API-direct submissions (Ashby, Greenhouse) complete in < 10s per application
3. Playwright submissions (LinkedIn, Indeed, Gem, Workday) complete in < 90s per application
4. Follow-up email drafts generated in < 5s via Claude API
5. Sidecar starts in < 8s from app launch, recovers from crash within 15s
6. Full batch of 8 applications submitted in < 10 minutes total

### Hard constraints

- Tauri 2 + React 19 + TypeScript
- Fork of dannysmith/tauri-template
- Python 3.12+ sidecar with FastAPI
- All credentials in macOS Keychain
- Dry-run default for all submissions — explicit confirmation required
- No auto-sending emails — always human review
- Headed Playwright only (no headless)
- PDF-only uploads to ATS platforms
- Personal Gmail only (not work)

### Locked decisions

| Decision                     | Locked to                                                 | Rationale                                                             |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Sidecar port                 | localhost:9876                                            | Fixed port, no discovery needed, PID file prevents duplicates         |
| Sidecar framework            | FastAPI                                                   | Async, auto-docs, lightweight, pydantic integration                   |
| Sidecar bundling             | PyInstaller (--onefile, aarch64-apple-darwin)             | Standard approach for Tauri sidecars, proven patterns exist           |
| Tracker view                 | Kanban board with drag-drop                               | Matches the existing artifact mental model, intuitive status flow     |
| Default submission mode      | Dry-run (preview what would be submitted)                 | Safety-first — `--submit` equivalent is a "Confirm & Submit" button   |
| LinkedIn session persistence | Playwright `launch_persistent_context()` with userDataDir | Login once, reuse session across runs                                 |
| Claude model for AI features | claude-sonnet-4-6                                         | Best balance of speed/quality/cost for email drafts and briefs        |
| Gmail auth                   | InstalledAppFlow (desktop OAuth2)                         | Standard Google approach for desktop apps, token.json in app data dir |

---

## 3. ARCHITECTURE

### Database Schema (SQLite)

```sql
-- Core job tracking
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,                          -- UUID
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    ats TEXT NOT NULL,                             -- ashby, greenhouse, gem, workday, linkedin, indeed, lever, other
    apply_url TEXT NOT NULL,
    job_posting_id TEXT,                           -- ATS-specific ID (Ashby posting ID, Greenhouse job ID)
    board_token TEXT,                              -- Greenhouse board token
    status TEXT NOT NULL DEFAULT 'saved',          -- saved, applied, interviewing, offer, rejected, archived
    tier TEXT NOT NULL DEFAULT 'tier1',            -- tier1 (tailored package) or tier2 (Easy Apply / base resume)
    source TEXT DEFAULT 'Company careers page',    -- How did you hear about us
    resume_path TEXT,                              -- Path to tailored resume PDF
    cover_letter_path TEXT,                        -- Path to tailored cover letter PDF
    custom_fields TEXT DEFAULT '{}',               -- JSON blob for ATS-specific answers
    notes TEXT DEFAULT '',                         -- Free-text notes
    applied_at TEXT,                               -- ISO 8601 timestamp
    follow_up_date TEXT,                           -- ISO 8601 date for next follow-up
    response_date TEXT,                            -- When company responded
    salary_range TEXT,                             -- Posted salary range
    location TEXT,                                 -- Job location
    jd_url TEXT,                                   -- URL to full job description
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Submission attempt log
CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    adapter TEXT NOT NULL,                         -- ashby_api, greenhouse_api, playwright_linkedin, etc.
    status TEXT NOT NULL,                          -- success, failed, dry_run, manual_required
    resume_uploaded INTEGER NOT NULL DEFAULT 0,
    cover_letter_uploaded INTEGER NOT NULL DEFAULT 0,
    fields_filled TEXT DEFAULT '[]',               -- JSON array of field names
    fields_skipped TEXT DEFAULT '[]',              -- JSON array of field names
    error TEXT,
    response_data TEXT,                            -- JSON blob of API response
    duration_seconds REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Follow-up email tracking
CREATE TABLE followups (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    draft_subject TEXT NOT NULL,
    draft_body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',          -- draft, sent, skipped
    scheduled_date TEXT NOT NULL,                  -- When to send
    sent_at TEXT,
    gmail_message_id TEXT,                         -- Gmail API message ID after sending
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Interview prep and per-company notes
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    note_type TEXT NOT NULL,                       -- interview_prep, company_research, general
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Applicant profile (singleton — only 1 row)
CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    linkedin_url TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT 'San Francisco, CA',
    authorized_to_work INTEGER NOT NULL DEFAULT 1,
    requires_sponsorship INTEGER NOT NULL DEFAULT 0,
    preferred_name TEXT,
    base_resume_path TEXT,                         -- Default resume for Tier 2 (Easy Apply)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_company ON jobs(company);
CREATE INDEX idx_submissions_job_id ON submissions(job_id);
CREATE INDEX idx_followups_job_id ON followups(job_id);
CREATE INDEX idx_followups_status_date ON followups(status, scheduled_date);
```

### Sidecar API Contract (FastAPI on localhost:9876)

```
GET  /health                           → { "status": "ok", "version": "1.0.0" }
POST /shutdown                         → Graceful shutdown

POST /submit                           → Submit a single application
     Body: { job: JobListing, profile: ApplicantProfile, dry_run: bool }
     Response: SubmissionResult (streamed via SSE for Playwright adapters)

POST /submit/batch                     → Submit multiple applications
     Body: { jobs: JobListing[], profile: ApplicantProfile, dry_run: bool }
     Response: SSE stream of SubmissionResult per job

GET  /adapters                         → List available adapters and their status
POST /adapters/{name}/validate         → Validate a job listing against an adapter

POST /gmail/auth                       → Initiate Gmail OAuth2 flow (opens browser)
GET  /gmail/status                     → Check Gmail auth status
POST /gmail/send                       → Send an email draft
     Body: { to: str, subject: str, body_html: str }

POST /ai/draft-followup                → Generate follow-up email draft via Claude
     Body: { company: str, role: str, applied_date: str, notes: str }
     Response: { subject: str, body: str }

POST /ai/interview-prep                → Generate interview prep brief via Claude
     Body: { company: str, role: str, jd_text: str, notes: str }
     Response: { brief: str }

POST /ai/map-fields                    → Smart field mapping for ATS forms
     Body: { form_definition: dict, profile: dict }
     Response: { mapped_fields: dict, unmapped_required: list }

GET  /playwright/sessions              → List active Playwright browser sessions
POST /playwright/sessions/{platform}/login → Open browser for manual login (LinkedIn, Indeed)
```

---

## 4. PHASED IMPLEMENTATION

### Phase 0: Foundation — Tauri App + Tracker + Sidecar Skeleton (Weeks 1-2)

**Session 1: Template fork + SQLite schema + basic Rust commands** (2-3h)

1. Fork dannysmith/tauri-template, rename to job-command-center
2. Strip demo content (keep sidebar, preferences, shortcuts infrastructure)
3. Add tauri-plugin-sql with SQLite, define all migrations from schema above
4. Implement Rust CRUD commands for `jobs` table: list_jobs, get_job, create_job, update_job, delete_job
5. Wire up tauri-specta to auto-generate TypeScript bindings

- Verification: `npm run tauri dev` opens app, commands callable from React DevTools console

**Session 2: Tracker Board UI** (2-3h)

1. Build Kanban board component using shadcn/ui Card + drag-drop (use @dnd-kit/core)
2. Columns: Saved, Applied, Interviewing, Offer, Rejected (Archived hidden by default)
3. Job cards show: company, role, tier badge, applied date, days since applied
4. Click card → slide-out detail panel with all fields, notes, submission history
5. "Add Job" button → modal form (company, role, ATS type, URL, tier)
6. TanStack Query hooks for all jobs queries with optimistic updates on drag-drop

- Verification: Can add job, drag between columns, click to see details

**Session 3: Python sidecar skeleton + health check** (2-3h)

1. Create `sidecar/` directory with pyproject.toml, FastAPI app
2. Implement `/health`, `/shutdown` endpoints
3. Implement BaseAdapter ABC with submit() and validate() methods
4. Implement Rust sidecar management: spawn on app launch, poll /health every 5s, auto-restart on crash, clean kill on app quit
5. Build sidecar status indicator in app header (green/yellow/red dot)
6. PyInstaller build script for aarch64-apple-darwin

- Verification: Sidecar starts with app, health indicator shows green, survives sidecar kill + auto-restart

**Session 4: Profile + Settings + File Linking** (2-3h)

1. Implement profile table CRUD in Rust
2. Build Settings page with profile form (name, email, phone, LinkedIn, location, auth/sponsorship, base resume path)
3. Build file browser component for resume/cover letter path selection (uses Tauri's dialog plugin)
4. Implement file existence validation — show warning icon on job cards where files are missing
5. Wire up Keychain integration for API keys (Anthropic, Google OAuth client ID/secret)

- Verification: Can save profile, select files, store API key in Keychain, retrieve it

**Phase 0 Deliverables:**

- Working Tauri app with Kanban tracker, persistent SQLite storage
- Python sidecar running with health monitoring
- Applicant profile management
- File path linking with validation
- Credential storage in Keychain

---

### Phase 1: API-Direct Submission Adapters (Weeks 3-4)

**Session 5: Ashby adapter** (2-3h)

1. Implement Ashby URL parser (extract posting ID from jobs.ashbyhq.com URLs)
2. Implement form definition fetcher via `jobPosting.info` API
3. Implement dynamic field mapper (profile → system fields + custom_fields → form paths)
4. Implement multipart/form-data submission via httpx with file uploads
5. Implement retry with exponential backoff (429/5xx)
6. Test against Ramp and Whatnot posting IDs

- Verification: Dry-run shows field mapping for Ramp. Real submission succeeds for one listing.

**Session 6: Greenhouse adapter + Submit Console UI** (2-3h)

1. Implement Greenhouse URL parser (board_token + job_id extraction)
2. Implement form question fetcher via boards-api
3. Implement field mapping and client-side required field validation
4. Implement multipart submission (handle API key discovery/fallback)
5. Build Submit Console view in React: select jobs from tracker → preview submission details → "Submit" or "Dry Run" buttons → real-time result stream
6. Wire SSE stream from sidecar to TanStack Query for live submission status updates

- Verification: Submit Console shows job queue, Ashby + Greenhouse submissions work, tracker auto-updates to "Applied"

**Phase 1 Deliverables:**

- Ashby API adapter (covers ~40% of target listings)
- Greenhouse API adapter (covers ~20% more)
- Submit Console with dry-run preview and real-time status
- Auto-update tracker status on successful submission
- Auto-set follow-up date (+7 days from submission)

---

### Phase 2: Playwright Adapters — LinkedIn, Indeed, ATS Fallback (Weeks 5-6)

**Session 7: Playwright base + LinkedIn Easy Apply** (3h)

1. Implement PlaywrightBase: launch_persistent_context with stealth config (headed, real Chrome channel, webdriver flag patch, human-like timing)
2. Implement session management: first-time manual login flow (opened via UI button), session reuse on subsequent runs
3. Implement LinkedIn Easy Apply flow: navigate to listing → click Easy Apply → fill multi-step modal (contact info, resume upload, screening questions) → pause before submit
4. Implement `set_input_files()` for resume upload
5. Handle LinkedIn screening questions via custom_fields mapping + Claude AI fallback for open-ended questions

- Verification: LinkedIn login persists across app restarts. Easy Apply fills a real listing (dry-run, no submit).

**Session 8: Indeed + Gem + Workday + Generic** (3h)

1. Implement Indeed Apply flow (similar pattern to LinkedIn — persistent context, form fill, file upload, pause before submit)
2. Implement Gem strategy (navigate, fill standard fields, upload files)
3. Implement Workday strategy (multi-page flow: navigate pages, fill each, upload on document page)
4. Implement Generic strategy (heuristic: scan labels, match to profile fields, upload to any file input, log unmatched as NEEDS_MANUAL)
5. Add "Login to LinkedIn/Indeed" buttons in Settings that open Playwright browser for manual auth

- Verification: Each adapter fills at least one real listing in dry-run mode. Session persistence works for LinkedIn and Indeed.

**Phase 2 Deliverables:**

- LinkedIn Easy Apply automation with session persistence
- Indeed Apply automation with session persistence
- Gem, Workday, Generic Playwright fallbacks
- "Login to Platform" flow in Settings
- Pause-before-submit for all Playwright adapters

---

### Phase 3: Follow-ups, Interview Prep, Analytics (Weeks 7-8)

**Session 9: Follow-up email system** (2-3h)

1. Implement Claude AI draft-followup endpoint: takes company/role/date/notes, returns subject + body
2. Implement Gmail OAuth2 flow (InstalledAppFlow, store token in app data dir)
3. Implement Gmail send endpoint (constructs MIMEText, base64 encodes, calls gmail.send)
4. Build Follow-up Manager view: list of pending follow-ups (auto-generated at +7 days), draft preview, edit, send/skip buttons
5. Auto-generate follow-up row when job status changes to "Applied"
6. Show sent follow-up in job detail timeline

- Verification: Follow-up drafts generate for applied jobs. Gmail auth works. Email sends successfully (test with self-send).

**Session 10: Interview prep + Analytics** (2-3h)

1. Implement Claude AI interview-prep endpoint: takes company/role/JD, returns structured brief (company background, recent news, likely questions, talking points)
2. Build Interview Prep view: auto-generate brief when status changes to "Interviewing," editable notes section
3. Build Pipeline Analytics dashboard: applications by week, response rate, conversion funnel (Applied → Interview → Offer), average time-to-response, breakdown by ATS type
4. Use Recharts for visualization (already available in the template ecosystem)

- Verification: Interview prep brief generates on status change. Analytics show accurate data for existing submissions.

**Phase 3 Deliverables:**

- Claude-drafted follow-up emails, sent via Gmail
- Interview prep brief auto-generation
- Pipeline analytics dashboard
- Complete end-to-end pipeline: Save → Submit → Track → Follow Up → Interview Prep

---

## 5. SECURITY & CREDENTIALS

- **Anthropic API key:** macOS Keychain via `keyring.set_password("jcc", "anthropic-api-key", key)`. Retrieved by sidecar at startup.
- **Google OAuth2 credentials:** Client ID/secret stored in Keychain. Token.json stored in Tauri's app data directory (`$HOME/Library/Application Support/com.jcc.app/`). Token auto-refreshes.
- **LinkedIn/Indeed sessions:** Playwright persistent context stored in `$HOME/Library/Application Support/com.jcc.app/playwright_data/`. Contains cookies and session tokens. Encrypted at rest by macOS.
- **Greenhouse API keys:** Stored in Keychain per board_token after first discovery.
- **SQLite database:** Stored in Tauri's app data directory. Contains job data and notes. No PII beyond what the user enters.
- **Applicant PII:** Stored in SQLite `profile` table. Never transmitted except to ATS endpoints during submission and Gmail during follow-up send. Never logged.
- **Sidecar communication:** localhost only (127.0.0.1:9876). Not exposed to network.

---

## 6. TESTING STRATEGY

### Phase 0

- Manual: Add 10 jobs, drag between columns, verify SQLite persistence across app restarts
- Manual: Kill sidecar process, verify auto-restart within 15s
- Automated: Rust integration tests for CRUD commands (jobs, profile)

### Phase 1

- Manual: Submit to one real Ashby listing (Ramp or Whatnot)
- Manual: Submit to one real Greenhouse listing (Superhuman)
- Automated: Python unit tests for URL parsers, field mappers (10+ test cases each)
- Automated: Mock HTTP tests for adapter submission logic

### Phase 2

- Manual: LinkedIn Easy Apply on one real listing (headed, visual verification)
- Manual: Indeed Apply on one real listing
- Manual: Verify session persistence across app restarts for both platforms
- Automated: Screenshot comparison on dry-run fills

### Phase 3

- Manual: Self-send follow-up email via Gmail, verify receipt
- Manual: Trigger interview prep generation, verify content quality
- Automated: Verify analytics calculations against known submission data

---

## 7. CLAUDE CODE HANDOFF NOTES

### Recommended session structure

- **Session 1:** Fork template, SQLite schema, Rust CRUD commands (2-3h)
- **Session 2:** Tracker Board Kanban UI (2-3h)
- **Session 3:** Python sidecar skeleton + health monitoring (2-3h)
- **Session 4:** Profile settings + file linking + Keychain (2-3h)
- **Session 5:** Ashby API adapter (2-3h)
- **Session 6:** Greenhouse adapter + Submit Console UI (2-3h)
- **Session 7:** Playwright base + LinkedIn Easy Apply (3h)
- **Session 8:** Indeed + Gem + Workday + Generic adapters (3h)
- **Session 9:** Follow-up email system (Gmail + Claude drafts) (2-3h)
- **Session 10:** Interview prep + Analytics dashboard (2-3h)

### Context management per session

- Always include: CLAUDE.md
- Session 1-2: + relevant Rust files + migration SQL
- Session 3-4: + sidecar/src/main.py + Rust sidecar commands
- Session 5-6: + sidecar/src/adapters/ + Submit Console component
- Session 7-8: + sidecar/src/services/playwright_base.py + adapter file
- Session 9-10: + sidecar/src/services/gmail.py + claude_ai.py + React views

### Known gotchas

- dannysmith/tauri-template uses AGPL — fine for personal use, strip if you ever distribute
- tauri-specta requires `cargo build` to regenerate TS bindings after changing Rust commands
- PyInstaller on M-series Macs needs `--target-arch arm64` and may require Rosetta for some deps
- Playwright `launch_persistent_context()` with `channel="chrome"` uses system Chrome, not bundled Chromium — avoids some bot detection but requires Chrome installed
- FastAPI sidecar should bind to `127.0.0.1` (not `0.0.0.0`) to prevent network exposure
- LinkedIn rate limits Easy Apply — cap at 10 per session, 30 min cooldown between sessions
- Greenhouse Job Board API doesn't validate required fields server-side — build client validation
- TanStack Query `staleTime: Infinity` for data that only changes via user actions (job status, notes)
