# Implementation Roadmap

## Session Strategy

Each Claude Code session tackles ONE focused unit of work. Sessions are scoped to ~2-3 hours. The Tauri frontend and Python sidecar are developed in parallel — frontend sessions and sidecar sessions can interleave. After each session, update CLAUDE.md's "Current Phase" section.

---

## Phase 0: Foundation (Weeks 1-2)

### Session 1: Template fork + SQLite + Rust commands

**Focus:** Get the Tauri app running with a real database.

Tasks:

1. Clone dannysmith/tauri-template → rename to job-command-center
2. Update tauri.conf.json: identifier `com.jcc.app`, window title "Job Command Center"
3. Strip demo content but keep: sidebar layout, preferences system, shadcn theme, Zustand setup, TanStack Query setup, tauri-specta pipeline
4. Add `tauri-plugin-sql` with SQLite feature to Cargo.toml
5. Define all 5 migration files (jobs, submissions, followups, notes, profile tables)
6. Implement Rust commands in `commands/jobs.rs`: list_jobs, get_job, create_job, update_job, delete_job
7. Implement profile commands: get_profile, upsert_profile
8. Run `cargo build` to generate tauri-specta TS bindings
9. Verify from React: call `commands.listJobs()` and `commands.getProfile()` via TanStack Query

**Deliverables:** App launches, SQLite initialized, Rust CRUD works end-to-end
**Verification:** Open DevTools, call commands, see empty arrays/null. Insert a test job, retrieve it.
**Context files:** CLAUDE.md, IMPLEMENTATION-PLAN.md (schema section)

---

### Session 2: Tracker Board UI

**Focus:** Build the main view — a Kanban board for job tracking.

Tasks:

1. Install @dnd-kit/core and @dnd-kit/sortable
2. Build `KanbanBoard` component with 5 columns (Saved, Applied, Interviewing, Offer, Rejected)
3. Build `JobCard` component: company name, role, tier badge (T1/T2), applied date, days-since-applied counter
4. Implement drag-drop between columns → calls `updateJob({ status: newColumn })` → optimistic TanStack Query update
5. Build `AddJobModal`: company, role, ATS type dropdown, apply URL, tier select, source field
6. Build `JobDetailPanel` (slide-out): all job fields, editable notes textarea, submission history list, file path display with "Open in Finder" button
7. Add toggle to show/hide Archived column
8. Wire sidebar navigation: Tracker is the default/home view

**Deliverables:** Fully functional Kanban tracker with drag-drop, add, edit, detail view
**Verification:** Add 5 test jobs, drag between columns, edit details, relaunch app — all data persists
**Context files:** CLAUDE.md, `src/services/` (TanStack Query hooks), `src/lib/tauri-bindings.ts`

---

### Session 3: Python sidecar skeleton + health monitoring

**Focus:** Get the Python submission engine running alongside the Tauri app.

Tasks:

1. Create `sidecar/` directory with pyproject.toml (dependencies: fastapi, uvicorn, httpx, playwright, pydantic, structlog, keyring, anthropic, google-api-python-client, google-auth-oauthlib)
2. Implement `main.py`: FastAPI app on 127.0.0.1:9876 with `/health` and `/shutdown` endpoints
3. Implement `api/models.py`: Pydantic models for ApplicantProfile, JobListing, SubmissionResult
4. Implement `adapters/base.py`: BaseAdapter ABC with `submit()` and `validate()` abstract methods
5. Implement Rust sidecar management in `commands/sidecar.rs`:
   - `start_sidecar()`: spawn PyInstaller binary, store PID
   - `stop_sidecar()`: POST /shutdown, wait 5s, SIGTERM if needed
   - `check_sidecar_health()`: GET /health, return status
   - Auto-start on app launch via Tauri setup hook
   - Auto-kill on app quit via Tauri on_close hook
6. Build sidecar status indicator in app header bar (green dot = healthy, yellow = starting, red = down)
7. Create PyInstaller spec file + build script for aarch64-apple-darwin
8. Test: start app → sidecar starts → kill sidecar manually → auto-restart

**Deliverables:** Sidecar starts/stops with app, health monitoring works, auto-restart on crash
**Verification:** App header shows green dot. `kill` the sidecar PID → yellow then green within 15s. App quit → no orphan Python processes.
**Context files:** CLAUDE.md, `src-tauri/src/commands/sidecar.rs`, `sidecar/src/main.py`

---

### Session 4: Profile + Settings + File Linking

**Focus:** User configuration — profile, credentials, file paths.

Tasks:

1. Build Settings page with tabs: Profile, Credentials, Platforms
2. Profile tab: form bound to `profile` table (name, email, phone, LinkedIn, location, auth/sponsorship, base resume path)
3. Credentials tab: Anthropic API key input → stored in Keychain via Rust command, masked display. Google OAuth status indicator.
4. Platforms tab: "Login to LinkedIn" button (calls sidecar endpoint to open Playwright browser), "Login to Indeed" button, session status indicators
5. Implement Tauri dialog plugin for file/directory selection (resume/cover letter paths)
6. Add file validation: when displaying job cards, check if resume_path and cover_letter_path exist → show warning icon if missing
7. Wire up Keychain read/write via Rust commands (tauri-plugin-keychain or custom keyring wrapper)

**Deliverables:** Profile management, credential storage, file path selection with validation
**Verification:** Save profile → persists across restart. Store API key → retrieve from Keychain. Select resume file → path stored in job record. Missing file → warning icon on card.
**Context files:** CLAUDE.md, `src/components/settings/`, Rust credential commands

---

## Phase 1: API-Direct Adapters (Weeks 3-4)

### Session 5: Ashby API adapter

**Focus:** First real submission adapter — API-direct, no browser needed.

Tasks:

1. Implement `adapters/ashby.py`: URL parser, form definition fetcher, field mapper, multipart submission
2. Implement `/submit` FastAPI endpoint (routes to correct adapter by ATS type)
3. Implement dry-run mode: fetch form def, validate mapping, return what WOULD be submitted
4. Implement retry with exponential backoff (2^n \* 1s, max 3 retries)
5. Test form fetcher against Ramp and Whatnot posting IDs
6. Test real submission against one Ashby listing
7. Return SubmissionResult with success/failure, fields filled, fields skipped, response data

**Deliverables:** Ashby adapter submits applications with file uploads via API
**Verification:** Dry-run for Ramp → complete field mapping displayed. Real submit → API returns success.
**Context files:** CLAUDE.md, `sidecar/src/adapters/base.py`, `sidecar/src/adapters/ashby.py`

---

### Session 6: Greenhouse adapter + Submit Console UI

**Focus:** Second API adapter + the React UI for batch submission.

Tasks:

1. Implement `adapters/greenhouse.py`: URL parser, form question fetcher, field mapping, multipart submission, API key handling
2. Implement `/submit/batch` endpoint with SSE streaming (yield SubmissionResult per job)
3. Build Submit Console view in React:
   - Job selection from tracker (checkboxes on Saved/Applied jobs)
   - Submission preview panel: per-job showing adapter, mapped fields, file paths, warnings
   - "Dry Run" button → runs without submitting, shows results
   - "Submit Selected" button → submits with real-time progress (SSE stream)
   - Result cards: green (success), yellow (manual required), red (failed) with details
4. On successful submission: auto-update job status to "Applied", set applied_at, set follow_up_date to +7 days
5. Write submission record to `submissions` table

**Deliverables:** Greenhouse adapter + Submit Console UI with batch operation + auto-tracker updates
**Verification:** Select 2 Ashby + 1 Greenhouse job → Dry Run shows correct previews → Submit → tracker updates to Applied.
**Context files:** CLAUDE.md, `sidecar/src/adapters/greenhouse.py`, `src/components/submit/`

---

## Phase 2: Playwright Adapters (Weeks 5-6)

### Session 7: Playwright base + LinkedIn Easy Apply

**Focus:** Browser automation foundation + the highest-value Playwright adapter.

Tasks:

1. Implement `services/playwright_base.py`: persistent context manager, stealth config, human-like delays, screenshot-on-failure
2. Implement `/playwright/sessions/{platform}/login` endpoint: opens headed browser for manual LinkedIn login, saves session to persistent context dir
3. Implement `adapters/linkedin.py`: LinkedIn Easy Apply flow
   - Navigate to listing URL → click "Easy Apply" button
   - Handle multi-step modal: Contact Info → Resume → Screening Questions → Review
   - Upload resume via `set_input_files()` on file input
   - Fill screening questions from custom_fields + Claude AI for open-ended questions
   - Pause before final submit → SSE message to frontend "Ready to submit — confirm?"
   - On confirm → click Submit
4. Implement rate limiting: max 10 Easy Apply per session, 30min cooldown tracking
5. Stream Playwright progress updates via SSE (current step, screenshots, status)

**Deliverables:** LinkedIn Easy Apply automation with session persistence and pause-before-submit
**Verification:** Login to LinkedIn via Settings → session persists. Dry-run Easy Apply → form filled. User confirms → submitted.
**Context files:** CLAUDE.md, `sidecar/src/services/playwright_base.py`, `sidecar/src/adapters/linkedin.py`

---

### Session 8: Indeed + Gem + Workday + Generic

**Focus:** Remaining Playwright adapters.

Tasks:

1. Implement `adapters/indeed.py`: Indeed Apply flow (persistent context, form fill, file upload, pause-before-submit)
2. Implement `adapters/gem.py`: Gem/Retool form fill (standard fields + file upload)
3. Implement `adapters/workday.py`: Workday multi-page flow handler
4. Implement `adapters/generic.py`: heuristic form filler (label text matching, file input detection)
5. Add "--wait-for-captcha" mode: pause and prompt user to solve CAPTCHA manually, then continue
6. Update Submit Console to show Playwright browser window status and screenshot previews

**Deliverables:** Full Playwright adapter coverage for all current ATS platforms
**Verification:** Each adapter fills one real listing in dry-run mode. Session persistence for LinkedIn/Indeed across app restarts.
**Context files:** CLAUDE.md, `sidecar/src/adapters/`, `sidecar/src/services/playwright_base.py`

---

## Phase 3: Follow-ups, Interview Prep, Analytics (Weeks 7-8)

### Session 9: Follow-up email system

**Focus:** Claude-drafted follow-up emails sent via Gmail.

Tasks:

1. Implement `services/claude_ai.py`: Anthropic SDK wrapper with draft_followup() and interview_prep() methods
2. Implement `services/gmail.py`: OAuth2 flow (InstalledAppFlow), token management, send_email()
3. Implement `/gmail/auth`, `/gmail/status`, `/gmail/send` endpoints
4. Implement `/ai/draft-followup` endpoint
5. Build Follow-up Manager view in React:
   - List of pending follow-ups (auto-created when job → Applied, scheduled for +7 days)
   - Draft preview with subject and body (editable)
   - "Regenerate Draft" button (calls Claude again)
   - "Send" button → calls Gmail send → updates followup status
   - "Skip" button → marks as skipped
   - Sent follow-ups appear in job detail timeline
6. Auto-generate followup record when job status changes to "Applied"

**Deliverables:** End-to-end follow-up pipeline: auto-schedule → AI draft → user review → Gmail send
**Verification:** Apply to a job → followup auto-created at +7 days. Click draft → Claude generates email. Click send → email arrives in inbox. Job timeline shows sent follow-up.
**Context files:** CLAUDE.md, `sidecar/src/services/gmail.py`, `sidecar/src/services/claude_ai.py`, `src/components/followup/`

---

### Session 10: Interview prep + Analytics dashboard

**Focus:** The last two views — intelligence and visibility.

Tasks:

1. Implement `/ai/interview-prep` endpoint: Claude generates structured brief (company overview, recent news, likely questions, talking points, red flags to ask about)
2. Build Interview Prep view:
   - Auto-generate brief when job status → "Interviewing"
   - Editable markdown notes section below the brief
   - "Regenerate Brief" button
3. Build Analytics Dashboard:
   - Applications by week (bar chart, Recharts)
   - Pipeline funnel: Saved → Applied → Interviewing → Offer (funnel chart)
   - Response rate (% of Applied that got any response)
   - Average days to response
   - Breakdown by ATS type (pie chart)
   - Tier 1 vs Tier 2 comparison
4. Add sidebar navigation for all views: Tracker, Submit, Follow-ups, Interview Prep, Analytics, Settings

**Deliverables:** Interview prep briefs, pipeline analytics, complete navigation
**Verification:** Change job to Interviewing → brief auto-generates. Analytics show accurate data for all test submissions.
**Context files:** CLAUDE.md, `src/components/interview/`, `src/components/pipeline/`

---

## Context Management

- Always include CLAUDE.md in every session
- For React sessions: include relevant component files + TanStack Query hooks + tauri-bindings.ts
- For sidecar sessions: include relevant adapter/service files + FastAPI routes
- For Rust sessions: include relevant command files + migrations
- Maximum context files per session: 5-7 (keep focused)
- After each session, update CLAUDE.md "Current Phase" with completed tasks and next steps
