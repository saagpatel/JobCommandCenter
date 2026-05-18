# Job Command Center

## Overview

A Tauri 2 desktop app that serves as the central hub for an automated job-search pipeline. Tracks job listings, automates application submissions across ATS platforms (Ashby, Greenhouse via HTTP; LinkedIn, Indeed, Gem, Workday, Generic via Playwright), manages follow-up emails via Gmail API, generates interview prep briefs via Claude AI, and reports pipeline analytics. The submission engine runs as a Python sidecar (FastAPI on localhost:9876) bundled via PyInstaller and lifecycle-managed by the Rust backend.

**Status: v1.0 feature complete. v1.1 backlog documented.**

---

## Tech Stack

### Layer 1 — Tauri / Rust Backend
- **Tauri:** 2.x (from `src-tauri/Cargo.toml`: `tauri = { version = "2", ... }`)
- **Rust edition:** 2021
- **IPC type safety:** tauri-specta 2.0.0-rc.21 (auto-generates TS bindings; run `pnpm rust:bindings` after Rust command changes)
- **Database:** SQLite via `tauri-plugin-sql` (sqlx under the hood); migrations in `src-tauri/src/migrations/`
- **Keychain:** `tauri-plugin-keychain` (Rust side) + `keyring` Python package (sidecar side)

### Layer 2 — React Frontend
- **Framework:** React 19 + TypeScript (strict) + Vite
- **UI:** shadcn/ui + Tailwind CSS
- **State:** `useState` (component) → Zustand 5 (global UI) → TanStack Query 5 (SQLite/persistent data)
- **Package manager:** **pnpm** (pnpm v10 per CI; `pnpm-lock.yaml` is canonical — ignore `package-lock.json` which is an orphan from the initial template scaffold)

### Layer 3 — Python Sidecar
- **Location:** `sidecar/` — source; `src-tauri/binaries/` — compiled PyInstaller binary
- **Python:** 3.12+
- **HTTP framework:** FastAPI + uvicorn (port 9876)
- **ATS clients:** httpx (Ashby, Greenhouse API-direct)
- **Browser automation:** Playwright 1.52+ with persistent Chromium profiles (headed only — no headless)
- **AI:** Anthropic SDK (`anthropic>=0.52`) using claude-sonnet-4-6
- **Gmail:** `google-api-python-client` OAuth2 InstalledAppFlow; token at `~/.jcc/gmail/`; `client_secrets.json` must be placed at `~/.jcc/gmail/client_secrets.json` by the user before connecting
- **Logging:** structlog
- **Validation:** Pydantic v2

---

## Local Dev Workflow

```bash
# Start Tauri dev mode (Rust + React hot-reload + sidecar auto-spawn)
pnpm tauri:dev           # runs: source ~/.cargo/env && npm run tauri dev

# Frontend-only (no Rust, no sidecar — for UI work)
pnpm dev                 # Vite dev server only

# Type-check frontend
pnpm typecheck           # tsc --noEmit

# Regenerate TS bindings after changing Rust commands
pnpm rust:bindings       # cargo test export_bindings -- --ignored --nocapture
```

Build artifacts land in `src-tauri/target/` (Rust) and `dist/` (Vite). The sidecar binary must be compiled separately via PyInstaller and placed in `src-tauri/binaries/` before `tauri:build` works end-to-end.

SQLite DB lives at: `~/Library/Application Support/com.jcc.app/jcc.db` (WAL mode, FK enabled).

---

## Test Commands

### Frontend (vitest) — CI GREEN
```bash
pnpm test:run            # vitest run (non-interactive)
pnpm test                # vitest watch mode (dev only)
pnpm test:coverage       # vitest run --coverage
pnpm typecheck           # tsc --noEmit (separate from tests)
```
~11 test files in `src/`. CI uses `pnpm install --frozen-lockfile` + `pnpm test`.

### Rust Backend (cargo) — CI STATUS: CHECK FIRST
```bash
pnpm rust:test           # cd src-tauri && cargo test
pnpm rust:clippy         # cargo clippy -- -D warnings
pnpm rust:fmt:check      # cargo fmt --check
```
CI job `test-backend` installs Linux GTK/WebKit system deps (`libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, etc.) before running `cargo nextest run || cargo test`. **This CI job requires system dependencies not available on macOS developer machines without Homebrew equivalents — run `cargo test` locally directly, not via CI.**

There are ~5 `#[test]` blocks in `src-tauri/src/`.

### Python Sidecar (pytest) — CI GREEN
```bash
cd sidecar && pytest
```
CI: `pip install -r requirements.txt && pip install -e .[test]` then `pytest`. ~11 test files in `sidecar/tests/`. This is the most reliable CI lane — green and straightforward.

### Full check suite (local only)
```bash
pnpm check:all           # typecheck + lint + ast:lint + format:check + rust:fmt:check + rust:clippy + test:run + rust:test
pnpm fix:all             # lint:fix + format + rust:fmt + rust:clippy:fix
```

---

## Build

```bash
# Production Tauri build (requires sidecar binary in src-tauri/binaries/)
pnpm tauri:build

# Frontend bundle only
pnpm build               # tsc && vite build
```

**Sidecar must be compiled with PyInstaller** and placed in `src-tauri/binaries/` before `tauri:build`. The binary is not checked into git. Check `src-tauri/tauri.conf.json` for the expected binary name.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TAURI DESKTOP APP                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │              React 19 Frontend                   │    │
│  │  Tracker | Submit Console | Follow-ups           │    │
│  │  Interview Prep | Analytics | Settings           │    │
│  │  Zustand (UI state) + TanStack Query (SQLite)    │    │
│  └────────────────────┬─────────────────────────────┘    │
│                       │ IPC (tauri-specta)                │
│  ┌────────────────────┴─────────────────────────────┐    │
│  │              Rust Backend                         │    │
│  │  • SQLite CRUD (jobs, submissions, followups,     │    │
│  │    notes, analytics)                              │    │
│  │  • Sidecar lifecycle (spawn, health, shutdown)    │    │
│  │  • Credential management (Keychain)               │    │
│  └────────────────────┬─────────────────────────────┘    │
└───────────────────────┼──────────────────────────────────┘
                        │ HTTP (localhost:9876)
┌───────────────────────┴──────────────────────────────────┐
│               PYTHON SIDECAR (FastAPI)                    │
│  Ashby API | Greenhouse API | Playwright Engine           │
│  Gmail OAuth2 | Claude AI Service                         │
└──────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
job-command-center/
├── src/                          # React frontend
│   ├── components/
│   │   ├── tracker/              # Kanban job board
│   │   ├── submit/               # Submission console (batch SSE)
│   │   ├── pipeline/             # Analytics dashboard
│   │   ├── followup/             # Follow-up email manager
│   │   ├── interview/            # Interview prep notes + AI briefs
│   │   └── settings/             # Profile / credentials / platforms
│   ├── hooks/                    # Custom React hooks
│   ├── stores/                   # Zustand stores (UI state)
│   ├── services/                 # TanStack Query hooks (SQLite data)
│   └── lib/
│       ├── tauri-bindings.ts     # Auto-generated by tauri-specta (DO NOT EDIT)
│       └── query-client.ts
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # jobs.rs, notes.rs, analytics.rs,
│   │   │                         # submissions.rs, followups.rs, sidecar.rs
│   │   └── migrations/           # SQLite schema migrations
│   └── binaries/                 # PyInstaller-compiled sidecar (not in git)
├── sidecar/                      # Python sidecar source
│   ├── pyproject.toml
│   ├── src/
│   │   ├── main.py               # FastAPI entry point
│   │   ├── api/                  # routes.py, models.py
│   │   ├── adapters/             # base.py, ashby.py, greenhouse.py,
│   │   │                         # linkedin.py, indeed.py, gem.py,
│   │   │                         # workday.py, generic.py
│   │   ├── services/             # gmail.py, claude_ai.py, playwright_base.py
│   │   └── utils/                # files.py, credentials.py (keyring wrapper)
│   └── tests/
└── configs/
    ├── profile.yaml              # Reusable applicant profile
    └── batch_example.yaml
```

---

## Project-Specific Conventions

- **TypeScript:** Strict mode, no `any`, functional components only. React Compiler handles memoization — no manual `useMemo`/`useCallback`.
- **State layer discipline:** component UI → `useState`; cross-component UI → Zustand; persistent data → TanStack Query + SQLite.
- **Rust commands:** Always defined via tauri-specta. Run `pnpm rust:bindings` after any Rust command signature change to regenerate `src/lib/tauri-bindings.ts`. Never edit `tauri-bindings.ts` by hand.
- **Python:** Type hints on all functions, Pydantic v2 models for all request/response shapes, structlog for logging (never `print()`). No raw dicts for shared data shapes.
- **Sidecar port:** Hardcoded to 9876. If occupied, user sees a generic health-check failure (v1.1 backlog item #21).
- **Migration runs:** ALL migrations run on every launch (no version tracking yet — v1.1 backlog item #11). Do not use `ALTER TABLE` without adding a `_schema_version` table first.
- **specta BigIntForbidden:** `i64` is not supported for TS export via tauri-specta. Use `i32` for all count/analytics types.
- **Git commits:** `feat(tracker): …` / `fix(sidecar): …` — scope matches the layer that changed.

---

## Current Phase

**v1.0 feature complete.** All 10 build sessions done (Phases 0–3).

**v1.1 backlog (not started):** migration version tracking, shared FieldMapper class, "Today" dashboard, URL auto-detect, tracker search/filter, bulk actions, CSV export, duplicate URL detection, submission retry, macOS notifications for due follow-ups, sidecar port conflict diagnostic.

Next session should pick from the backlog or address post-v1.0 issues. Check `IMPLEMENTATION-ROADMAP.md` for the canonical phase list.

---

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Desktop framework | Tauri 2 (not Electron) | 10-20MB vs 200MB+, native macOS feel |
| IPC | tauri-specta | Type-safe Rust→TS binding generation |
| Database | sqlx / tauri-plugin-sql | Rust-side migrations; React Query caching on frontend |
| Sidecar language | Python | Best Playwright + Anthropic SDK + Gmail API support |
| Sidecar comm | FastAPI localhost:9876 | Streaming SSE support, auto-docs, more flexible than stdin/stdout |
| ATS strategy | API-first (Ashby, Greenhouse), Playwright-fallback | API faster, immune to DOM changes |
| LinkedIn/Indeed | Playwright headed | Persistent browser context, stealth anti-detection |
| Gmail | Google API OAuth2 InstalledAppFlow | gmail.send scope only, token stored locally at ~/.jcc/gmail/ |
| LLM | claude-sonnet-4-6 via Anthropic SDK | Email drafting + field mapping + interview prep |
| Ashby auth | Basic auth with api_key | Endpoints return 401 without key — plan assumed public |
| Profile table | Singleton row (id=1, CHECK constraint), INSERT OR REPLACE | Simpler than nullable singleton |

---

## Do NOT

- Do not use `npm` — the package manager is **pnpm**. `package-lock.json` in the repo root is an orphan from the initial template; ignore it.
- Do not edit `src/lib/tauri-bindings.ts` by hand — it is auto-generated by tauri-specta on `pnpm rust:bindings`.
- Do not use `enum` in TypeScript — use string literal unions (global rule reinforced here because specta generates enums from Rust; always check generated bindings).
- Do not store credentials in SQLite, config files, or `.env` — macOS Keychain only (`keyring` Python / `tauri-plugin-keychain` Rust).
- Do not auto-submit applications or auto-send follow-up emails — always present for user review/confirmation first.
- Do not run Playwright in headless mode — headed only to reduce bot detection.
- Do not hardcode ATS form field selectors — use API-direct where available, heuristic matching for Playwright flows.
- Do not cache Playwright DOM selectors across page navigations (especially Workday multi-step).
- Do not log applicant PII (email, phone, SSN) to any log file — submission metadata only.
- Do not bundle Playwright browsers — require user to run `playwright install chromium` once during setup.
- Do not scaffold all ATS adapters in one session — each adapter is its own session.
- Do not put Playwright automation logic in the Rust backend — it belongs in the Python sidecar.
- Do not use Electron patterns (`ipcMain`/`ipcRenderer`) — use tauri-specta commands and events.
