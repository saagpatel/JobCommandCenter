# Job Command Center

## Project Overview

A Tauri 2 desktop app that serves as the central hub for an automated job search pipeline. Replaces a Claude.ai React artifact tracker with a full-featured local application. Tracks job listings, automates application submissions across ATS platforms (Ashby, Greenhouse, LinkedIn Easy Apply, Indeed) and browser-automated portals (Gem, Workday), manages follow-up emails via Gmail API, generates interview prep briefs, and provides analytics on the job search pipeline. The submission engine runs as a Python sidecar process bundled via PyInstaller, communicating with the Tauri frontend over a local HTTP API.

## Tech Stack

- **Desktop framework:** Tauri 2 (Rust backend + WebView frontend)
- **Frontend:** React 19 + TypeScript + Vite
- **UI components:** shadcn/ui + Tailwind CSS
- **State management:** Three-layer — useState (component) → Zustand (global UI) → TanStack Query (persistent/SQLite data)
- **Type-safe IPC:** tauri-specta (auto-generates TS bindings from Rust commands)
- **Database:** SQLite via tauri-plugin-sql (sqlx under the hood, migrations in Rust)
- **Sidecar (submission engine):** Python 3.12+ bundled via PyInstaller
  - HTTP API: FastAPI (lightweight, async, auto-docs)
  - ATS API clients: httpx (Ashby, Greenhouse)
  - Browser automation: Playwright (LinkedIn, Indeed, Gem, Workday)
  - LLM: Anthropic Python SDK (Claude Sonnet for email drafts, interview prep, field mapping)
- **Gmail integration:** Google API Python client with OAuth2 (gmail.send scope)
- **Credential storage:** macOS Keychain via keyring (Python) + tauri-plugin-keychain (Rust)
- **Starter template:** Fork of dannysmith/tauri-template (Tauri 2 + React 19 + shadcn/ui + Zustand + TanStack Query + tauri-specta)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TAURI DESKTOP APP                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              React 19 Frontend                   │    │
│  │                                                  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │    │
│  │  │ Tracker  │ │ Pipeline │ │  Follow-up     │   │    │
│  │  │ Board    │ │ Analytics│ │  Manager       │   │    │
│  │  └──────────┘ └──────────┘ └────────────────┘   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │    │
│  │  │ Submit   │ │ Interview│ │  Settings      │   │    │
│  │  │ Console  │ │ Prep     │ │                │   │    │
│  │  └──────────┘ └──────────┘ └────────────────┘   │    │
│  │                                                  │    │
│  │  Zustand (UI state) + TanStack Query (SQLite)    │    │
│  └────────────────────┬─────────────────────────────┘    │
│                       │ IPC (tauri-specta)                │
│  ┌────────────────────┴─────────────────────────────┐    │
│  │              Rust Backend                         │    │
│  │  • SQLite CRUD commands                           │    │
│  │  • File system access (~/job-search-2026/)        │    │
│  │  • Sidecar lifecycle (spawn/kill/health check)    │    │
│  │  • Credential management (Keychain)               │    │
│  └────────────────────┬─────────────────────────────┘    │
└───────────────────────┼──────────────────────────────────┘
                        │ HTTP (localhost:9876)
┌───────────────────────┴──────────────────────────────────┐
│               PYTHON SIDECAR (FastAPI)                    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Submission Engine                                  │  │
│  │  ┌──────────┐ ┌────────────┐ ┌────────────────┐    │  │
│  │  │ Ashby    │ │ Greenhouse │ │ Playwright     │    │  │
│  │  │ API      │ │ API        │ │ Engine         │    │  │
│  │  └──────────┘ └────────────┘ │ • LinkedIn EA  │    │  │
│  │                              │ • Indeed        │    │  │
│  │                              │ • Gem           │    │  │
│  │                              │ • Workday       │    │  │
│  │                              │ • Generic       │    │  │
│  │                              └────────────────┘    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Gmail Service (OAuth2, gmail.send)                 │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Claude AI Service (Anthropic SDK)                  │  │
│  │  • Follow-up email drafting                         │  │
│  │  • Interview prep brief generation                  │  │
│  │  • Smart form field mapping                         │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Project Structure

```
job-command-center/
├── CLAUDE.md
├── DISCOVERY-SUMMARY.md
├── IMPLEMENTATION-ROADMAP.md
├── RESUMPTION-PROMPT.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── src/                          # React frontend (from tauri-template)
│   ├── App.tsx
│   ├── components/
│   │   ├── tracker/              # Job tracker board (Kanban-style)
│   │   ├── submit/               # Submission console (batch submit UI)
│   │   ├── pipeline/             # Analytics dashboard
│   │   ├── followup/             # Follow-up email manager
│   │   ├── interview/            # Interview prep notes
│   │   └── settings/             # App settings + credential management
│   ├── hooks/                    # Custom React hooks
│   ├── stores/                   # Zustand stores (UI state)
│   ├── services/                 # TanStack Query hooks (SQLite data)
│   ├── lib/
│   │   ├── tauri-bindings.ts     # Auto-generated by tauri-specta
│   │   └── query-client.ts       # TanStack Query config
│   └── types/                    # Shared TypeScript types
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json          # Permissions (sql, shell, fs, etc.)
│   ├── src/
│   │   ├── lib.rs                # Plugin registration + setup
│   │   ├── commands/
│   │   │   ├── jobs.rs           # CRUD for job listings
│   │   │   ├── notes.rs          # CRUD for notes (interview prep, personal)
│   │   │   ├── analytics.rs      # Aggregate analytics queries
│   │   │   ├── submissions.rs    # Submission log queries
│   │   │   ├── followups.rs      # Follow-up scheduling
│   │   │   └── sidecar.rs        # Sidecar lifecycle management
│   │   └── migrations/           # SQLite schema migrations
│   └── binaries/                 # PyInstaller-compiled sidecar
├── sidecar/                      # Python submission engine source
│   ├── pyproject.toml
│   ├── src/
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── api/
│   │   │   ├── routes.py         # API endpoints
│   │   │   └── models.py         # Pydantic request/response models
│   │   ├── adapters/
│   │   │   ├── base.py           # BaseAdapter ABC
│   │   │   ├── ashby.py          # Ashby API adapter
│   │   │   ├── greenhouse.py     # Greenhouse API adapter
│   │   │   ├── linkedin.py       # LinkedIn Easy Apply (Playwright)
│   │   │   ├── indeed.py         # Indeed Apply (Playwright)
│   │   │   ├── gem.py            # Gem (Playwright)
│   │   │   ├── workday.py        # Workday (Playwright)
│   │   │   └── generic.py        # Generic ATS (Playwright heuristics)
│   │   ├── services/
│   │   │   ├── gmail.py          # Gmail OAuth2 send service
│   │   │   ├── claude_ai.py      # Anthropic SDK for AI features
│   │   │   └── playwright_base.py # Shared Playwright utilities
│   │   └── utils/
│   │       ├── files.py          # File validation
│   │       └── credentials.py   # Keyring wrapper
│   ├── playwright_data/          # Persistent browser profiles
│   └── tests/
└── configs/
    ├── profile.yaml              # Reusable applicant profile
    └── batch_example.yaml        # Example batch config
```

## Development Conventions

- **TypeScript:** Strict mode, no `any` types, functional components only
- **React:** Hooks only, no class components. React Compiler handles memoization (no manual useMemo/useCallback)
- **State:** Component UI → useState. Cross-component UI → Zustand. Persistent data → TanStack Query + SQLite
- **Rust commands:** All commands defined via tauri-specta for auto-generated TS bindings. Run `cargo build` to regenerate bindings.
- **Python:** Type hints on all functions, pydantic models for all data, httpx for HTTP, structlog for logging
- **File naming:** kebab-case for files, PascalCase for components, camelCase for hooks/utils
- **Git commits:** `feat(tracker): add kanban drag-drop` / `fix(sidecar): handle Ashby rate limit`

## Current Phase — v1.0 Polished, v1.1 Backlog Documented

**Phase 0: Foundation** (target: Week 1-2)

- [x] Fork dannysmith/tauri-template, strip demo content (Session 1)
- [x] Define SQLite schema (jobs, submissions, followups, notes) (Session 1)
- [x] Implement Rust CRUD commands for jobs table (Session 1)
- [x] Build Tracker Board view (Kanban: Saved → Applied → Interview → Offer → Rejected) (Session 2)
- [x] Set up Python sidecar project structure with FastAPI (Session 3)
- [x] Implement sidecar spawn/health-check from Rust backend (Session 3)
- [x] Create applicant profile settings page (Session 4)

**Phase 0 COMPLETE.**

**Phase 1: ATS Adapters**

## Manual overrides to the managed block below

- **Package manager: pnpm, not npm.** The portfolio-context block below incorrectly says "Use npm only; this repo does not use pnpm." Evidence: `pnpm-lock.yaml` exists, CI (`.github/workflows/test.yml`) uses `pnpm install --frozen-lockfile`, and recent commits `536c7ef`/`f5b8fa8` are pnpm v11 fixes. `package-lock.json` is an orphan from the initial template scaffold. Use `pnpm install`, `pnpm test`, `pnpm tsc --noEmit`.
- The portfolio-context generator should be patched to read CI workflow as ground truth (out of scope for this commit).

<!-- portfolio-context:start -->

# Portfolio Context

## What This Project Is

Job Command Center is a Tauri 2 desktop hub for an automated job-search pipeline. It tracks job listings, drives application submissions across ATS platforms and browser-automated portals, manages Gmail follow-ups, generates interview prep briefs, and reports pipeline analytics through a local app plus Python sidecar.

## Current State

The repo has moved beyond its template origin into a polished v1.0 posture with a documented v1.1 backlog. Phase 0 foundation is complete, and the product shape is centered on the tracker board, submission console, follow-up manager, interview prep, settings, and local sidecar lifecycle.

## Stack

- Tauri 2 desktop app with Rust backend and React 19 + TypeScript + Vite frontend
- shadcn/ui, Tailwind CSS, Zustand, TanStack Query, and tauri-specta bindings
- SQLite via Tauri SQL plugin and Rust migrations
- Python 3.12+ sidecar bundled with PyInstaller and exposed over local FastAPI
- Playwright, ATS API clients, Gmail API OAuth, Anthropic SDK, and macOS Keychain storage

## How To Run

- Use `npm` only; this repo does not use pnpm.
- Run the app with the documented npm scripts from `package.json`.
- Run `npm run check:all` after significant changes.
- Ask the operator to run the dev server when interactive app feedback is needed.

## Known Risks

- Job-search, Gmail, ATS, profile, and credential data are sensitive; keep credentials in Keychain and out of source.
- The Python sidecar is bundled and lifecycle-managed by the Rust backend; verify sidecar health after backend or packaging changes.
- Browser automation for LinkedIn, Indeed, Gem, Workday, and generic ATS flows is fragile and should be tested with real fixtures before shipping.
- Existing local changes touch the lockfile, sidecar binary, and local Claude skills; do not stage or rewrite them during portfolio context recovery.

## Next Recommended Move

Keep the active local branch focused on the existing lockfile/sidecar cleanup, then use `npm run check:all` and targeted sidecar health checks before changing submission automation, Gmail follow-up, or credential behavior.

<!-- portfolio-context:end -->

- [x] Ashby API adapter with form fetching, field mapping, multipart submit (Session 5)
- [x] Greenhouse API adapter + Submit Console UI with batch SSE streaming (Session 6)

**Phase 1 COMPLETE.**

**Note:** Ashby API requires authentication (API key via Basic auth). The plan assumed public endpoints but they return 401 without a key. API key is passed via `AshbyAdapter(api_key=...)` and stored in macOS Keychain. Greenhouse GET endpoints are public (no auth), but POST submission may require API key (returns 401/403 → `manual_required` status).

**Phase 2: Browser Automation Adapters**

- [x] Playwright base service + LinkedIn Easy Apply adapter + Claude AI field mapping (Session 7)
- [x] Indeed + Gem + Workday + Generic adapters (Session 8)

**Phase 2 COMPLETE.**

**Note:** Indeed adapter requires login session (like LinkedIn). Gem does not require login. Workday returns `manual_required` for sign-in pages and CAPTCHAs. Generic adapter uses heuristic label→input matching with Claude AI fallback for unmapped fields.

**Phase 3: Follow-up & Intelligence**

- [x] Follow-up email system with Gmail API + Claude AI drafting (Session 9)
- [x] Interview prep briefs + Analytics dashboard + sidebar badges + keyboard shortcuts (Session 10)

**Phase 3 COMPLETE. v1.0 Feature Complete — all 10 sessions done.**

**Note:** Session 9 built the full follow-up pipeline: Rust CRUD (5 commands + auto-create on status→"applied"), Python GmailService (OAuth2 InstalledAppFlow at ~/.jcc/gmail/), ClaudeAIService.draft_followup + interview_prep (interview_prep endpoint pre-built for Session 10), Frontend FollowupManager with filter tabs + expandable rows + AI draft generation + Gmail send. Gmail requires user to place client_secrets.json at ~/.jcc/gmail/client_secrets.json before connecting. User always reviews draft before sending — never auto-send.

**Note:** Session 10 (final): Notes CRUD (5 Rust commands), Analytics (7 Rust commands: applications by week, pipeline funnel, response rate, avg days to response, submissions by adapter, tier comparison, sidebar counts). Interview Prep view with AI brief generation via sidecar POST /ai/interview-prep, markdown rendering. Analytics dashboard with stat cards, stacked bar chart (recharts), pipeline funnel bars, ATS submission bars, tier comparison. Sidebar badges (followups due, prep needed) with 30s polling. Keyboard shortcuts Cmd+1-6 for view switching (sidebar toggles moved to Cmd+[/]). Auto-create interview_prep note on status→"interviewing".

**Post-v1.0 Backlog:** Lever adapter, Gmail inbox scanning, bulk LinkedIn import, Chrome extension, parallel Playwright sessions.

## v1.1 Backlog

| #   | Description                                                                                                                                                                                        | Category     | Effort | Impact |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ------ |
| 11  | **Migration version tracking** — current system runs ALL migrations on every launch; no `ALTER TABLE` path for v1.1 schema changes. Add a `_schema_version` table with sequential version numbers. | Architecture | medium | high   |
| 12  | **Shared field mapping utility** — profile→form field heuristic logic duplicated across 7 adapters. Extract a `FieldMapper` class with adapter-specific overrides.                                 | Architecture | large  | medium |
| 13  | **"Today" dashboard view** — landing page showing: due follow-ups, jobs awaiting submission, upcoming interviews, recent activity. Currently opens to Kanban.                                      | UX           | large  | high   |
| 14  | **URL auto-detect on Add Job** — paste an ATS URL, auto-detect company/role/ATS type from Greenhouse/Ashby/LinkedIn URL patterns (parsers already exist in adapters).                              | UX           | medium | high   |
| 15  | **Tracker search/filter** — filter by company name, ATS, tier, date range beyond just status.                                                                                                      | QoL          | medium | high   |
| 16  | **Bulk actions** — select multiple jobs → bulk archive, delete, change status.                                                                                                                     | QoL          | medium | medium |
| 17  | **CSV export** — export job search data + submission history.                                                                                                                                      | QoL          | small  | medium |
| 18  | **Duplicate URL detection** — warn when adding a job with same `apply_url` as existing one.                                                                                                        | QoL          | small  | medium |
| 19  | **Submission retry** — one-click retry from submission history for failed submissions.                                                                                                             | QoL          | medium | medium |
| 20  | **macOS notification for due follow-ups** — tauri-plugin-notification fires when follow-up is due today (check on app launch + periodic).                                                          | QoL          | small  | medium |
| 21  | **Sidecar port conflict diagnostic** — if port 9876 is in use, user sees generic "failed to become healthy" with no actionable message.                                                            | UX           | small  | medium |

## Key Decisions Made

| Decision                | Choice                                             | Rationale                                                                                                       |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Desktop framework       | Tauri 2 (not Electron)                             | 10-20MB vs 200MB+, native macOS feel, Rust backend perf                                                         |
| Starter template        | dannysmith/tauri-template fork                     | Pre-built shadcn/ui, Zustand, TanStack Query, tauri-specta, Claude Code-ready                                   |
| Sidecar language        | Python (not Node/Rust)                             | Best Playwright support, Anthropic SDK, Gmail API libs, fastest to build                                        |
| Sidecar communication   | Local HTTP (FastAPI on localhost:9876)             | More flexible than stdin/stdout, supports streaming responses for real-time UI updates, auto-generated API docs |
| LLM                     | Claude Sonnet via Anthropic API                    | Higher quality than local models for email drafting, already paying for Max 20x                                 |
| LinkedIn/Indeed         | Playwright Easy Apply                              | Persistent browser context with session reuse, stealth techniques for anti-detection                            |
| Gmail                   | Google API Python client, OAuth2                   | Desktop app flow (InstalledAppFlow), gmail.send scope only, token stored locally                                |
| Database                | SQLite via tauri-plugin-sql                        | Local-first, no server, migrations in Rust, React Query caching on frontend                                     |
| ATS submission strategy | API-first (Ashby, Greenhouse), Playwright-fallback | API is faster, more reliable, immune to DOM changes                                                             |

## Do NOT

- Do not scaffold the entire app in one session — each major view (Tracker, Submit Console, Follow-ups, Analytics) is its own session
- Do not put Playwright automation logic in the Tauri Rust backend — it stays in the Python sidecar
- Do not use Electron patterns (ipcMain/ipcRenderer) — use tauri-specta commands and events
- Do not store credentials in config files, SQLite, or .env — macOS Keychain only
- Do not auto-submit applications without explicit user confirmation — dry-run preview is always the default
- Do not auto-send follow-up emails — always present draft for user review, user clicks send
- Do not run Playwright in headless mode — headed only to reduce bot detection
- Do not hardcode ATS form field selectors — use API-direct submission where available, heuristic matching for Playwright
- Do not cache Playwright DOM selectors across page navigations (especially Workday multi-step)
- Do not log applicant PII (email, phone, SSN) to any log file — only submission metadata
- Do not bundle Playwright browsers with the app — require user to run `playwright install chromium` once during setup
- Do not attempt to scaffold all ATS adapters in one Claude Code session — each adapter is a full session
