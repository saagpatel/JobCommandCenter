# Job Command Center

Tauri 2 desktop hub for an automated job-search pipeline. Tracks listings, drives application submissions across ATS platforms (Ashby, Greenhouse) and browser-automated portals (LinkedIn, Indeed, Gem, Workday), manages Gmail follow-ups, generates interview-prep briefs, and reports pipeline analytics. v1.0 feature-complete (all 10 sessions); v1.1 backlog documented below.

## Stack & architecture

Three layers: a **Tauri 2 Rust backend** (SQLite CRUD via sqlx, sidecar lifecycle, Keychain) ↔ a **React 19 + TypeScript + Vite frontend** (shadcn/ui, Tailwind, Zustand for UI state, TanStack Query for SQLite data, tauri-specta bindings) ↔ a **Python 3.12 FastAPI sidecar** (PyInstaller-bundled) reachable over local HTTP on **port 9876**, holding the submission engine (httpx ATS clients + Playwright), Gmail OAuth2, and the Anthropic SDK. Forked from dannysmith/tauri-template. Local data dir: `~/job-search-2026/`.

## Build / test / run

```bash
pnpm install              # pnpm, NOT npm — see Gotchas
pnpm install --frozen-lockfile   # CI-equivalent install
pnpm test
pnpm tsc --noEmit
cargo build               # also regenerates tauri-specta TS bindings
pnpm run check:all        # aggregate check script
playwright install chromium   # one-time, user-run during setup (browsers are not bundled)
```

Ask the operator to run the dev server when interactive app feedback is needed.

## Gotchas

- **Package manager is pnpm, not npm.** `pnpm-lock.yaml` is authoritative and CI/release runs `pnpm install --frozen-lockfile`; do not regenerate an npm lockfile.
- **Credentials live in macOS Keychain only** — never in config files, SQLite, or `.env`.
- **Never auto-submit or auto-send.** Application submit defaults to a dry-run preview requiring explicit confirmation; follow-up emails always present a draft for user review before send.
- **Playwright runs headed, not headless** (reduces bot detection); browsers are user-installed via `playwright install chromium`, not bundled.
- **Sidecar health:** the Rust backend spawns/monitors the Python sidecar; verify health after backend or packaging changes. If port 9876 is in use the current error is a generic "failed to become healthy" (v1.1 #21 adds a real diagnostic).
- **Migrations run ALL on every launch** — there is no `ALTER TABLE` path yet (v1.1 #11 adds `_schema_version`). Treat shipped migrations as immutable; add new ones rather than editing.
- **Never log applicant PII** (email, phone, SSN) — submission metadata only.
- **Gmail setup:** user places `client_secrets.json` at `~/.jcc/gmail/client_secrets.json` (OAuth2 InstalledAppFlow, `gmail.send` scope only); token stored locally.
- **ATS notes:** Ashby needs an API key (Basic auth, Keychain-stored) — the public-endpoint assumption was wrong (401 without key). Greenhouse GETs are public; POST may return 401/403 → `manual_required`. Workday/CAPTCHA pages return `manual_required`. Generic adapter uses heuristic label→input matching with Claude AI fallback; don't hardcode or cache selectors across navigations.

## Conventions

- TypeScript strict, functional components, hooks only (React Compiler handles memoization — no manual useMemo/useCallback). State: useState (component) → Zustand (global UI) → TanStack Query + SQLite (persistent).
- Rust commands defined via tauri-specta; `cargo build` regenerates TS bindings. Playwright automation stays in the Python sidecar, never the Rust backend. Use tauri-specta commands/events, not Electron-style ipcMain/ipcRenderer.
- Python: type hints + pydantic models everywhere, httpx for HTTP, structlog for logging.
- Naming: kebab-case files, PascalCase components, camelCase hooks/utils. Commits: `feat(tracker): …` / `fix(sidecar): …`.
- Scope work per session: each major view and each ATS adapter is its own session — don't scaffold the whole app or all adapters at once.

## Key decisions

| Decision          | Choice                                             | Why                                                  |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Desktop framework | Tauri 2 (not Electron)                             | 10–20 MB vs 200 MB+, native macOS feel, Rust perf    |
| Sidecar language  | Python                                             | Best Playwright + Anthropic SDK + Gmail API support  |
| Sidecar transport | Local HTTP (FastAPI on :9876)                      | Streaming responses for real-time UI; auto API docs  |
| ATS strategy      | API-first (Ashby, Greenhouse), Playwright fallback | API is faster and immune to DOM changes              |
| Database          | SQLite via sqlx                                    | Local-first, migrations in Rust, React Query caching |

## v1.1 backlog

Migration version tracking (#11) · shared `FieldMapper` across the 7 adapters (#12) · "Today" dashboard landing view (#13) · URL auto-detect on Add Job (#14) · tracker search/filter (#15) · bulk actions (#16) · CSV export (#17) · duplicate-URL detection (#18) · submission retry (#19) · macOS due-follow-up notifications (#20) · sidecar port-conflict diagnostic (#21). Post-v1.0 ideas: Lever adapter, Gmail inbox scanning, bulk LinkedIn import, Chrome extension, parallel Playwright sessions.

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

- Use `pnpm`. This repo does not use `npm` — see the Gotchas section above.
- Run the app with the documented pnpm scripts from `package.json`.
- Run `pnpm run check:all` after significant changes.
- Ask the operator to run the dev server when interactive app feedback is needed.

## Known Risks

- Job-search, Gmail, ATS, profile, and credential data are sensitive; keep credentials in Keychain and out of source.
- The Python sidecar is bundled and lifecycle-managed by the Rust backend; verify sidecar health after backend or packaging changes.
- Browser automation for LinkedIn, Indeed, Gem, Workday, and generic ATS flows is fragile and should be tested with real fixtures before shipping.
- Existing local changes touch the lockfile, sidecar binary, and local Claude skills; do not stage or rewrite them during portfolio context recovery.

## Next Recommended Move

Keep the active local branch focused on the existing lockfile/sidecar cleanup, then use `pnpm run check:all` and targeted sidecar health checks before changing submission automation, Gmail follow-up, or credential behavior.

<!-- portfolio-context:end -->

<!-- secondbrain-breadcrumb -->

## SecondBrain knowledge vault

Prior lessons, decisions, and context for this project live in SecondBrain at `wiki/maps/projects/job-command-center.md`. The whole vault is searchable via the `engraph` MCP — query it for this project + its stack before non-trivial work.
