# Job Command Center

Tauri 2 desktop hub for an automated job-search pipeline. Tracks listings, drives application submissions across ATS platforms (Ashby, Greenhouse) and browser-automated portals (LinkedIn, Indeed, Gem, Workday), manages Gmail follow-ups, generates interview-prep briefs, and reports pipeline analytics. v1.0 feature-complete (all 10 sessions); v1.1 backlog documented below.

## Stack & architecture

Three layers: a **Tauri 2 Rust backend** (SQLite CRUD via sqlx, sidecar lifecycle, Keychain) ↔ a **React 19 + TypeScript + Vite frontend** (shadcn/ui, Tailwind, Zustand for UI state, TanStack Query for SQLite data, tauri-specta bindings) ↔ a **Python 3.12+ FastAPI sidecar** (PyInstaller-bundled) reachable over local HTTP on **port 9876**, holding the submission engine (httpx ATS clients + Playwright), Gmail OAuth2, and the Anthropic SDK. Forked from dannysmith/tauri-template. SQLite database: `jcc.db` in the Tauri app data directory; Gmail files and browser profiles use the `.jcc/gmail/` and `.jcc/playwright_data/` subdirectories of the user home directory.

## Build / test / run

```bash
pnpm install              # pnpm, NOT npm — see Gotchas
pnpm install --frozen-lockfile   # CI-equivalent install
pnpm test
pnpm tsc --noEmit
cargo build --manifest-path src-tauri/Cargo.toml # build the Rust backend
pnpm run rust:bindings    # regenerate tauri-specta TS bindings
pnpm run check:all        # aggregate check script
playwright install chromium   # optional, user-run in the sidecar Python environment (system Chrome is also supported)
```

Ask the operator to run the dev server when interactive app feedback is needed.

## Gotchas

- **Package manager is pnpm, not npm.** `pnpm-lock.yaml` is authoritative and CI/release runs `pnpm install --frozen-lockfile`; do not regenerate an npm lockfile.
- **API keys live in macOS Keychain** — never in config files, SQLite, or `.env`. Gmail OAuth client secrets and tokens are local JSON files in `GmailService._TOKEN_DIR`; Playwright profiles can retain browser session data in `PlaywrightManager._profile_base`.
- **Never auto-submit or auto-send.** Application submit defaults to a dry-run preview requiring explicit confirmation; follow-up emails always present a draft for user review before send.
- **Playwright runs headed, not headless** (reduces bot detection); uses installed Playwright Chromium or falls back to system Chrome; browser executables are not bundled by `sidecar/build.sh`.
- **Sidecar health:** the Rust backend spawns/monitors the Python sidecar; verify health after backend or packaging changes. An existing healthy service on port 9876 is adopted; a startup health timeout returns `Unhealthy` and monitoring continues. A dedicated port-conflict diagnostic remains backlog item #21.
- **Migrations track versions in `schema_migrations`** and include `ALTER TABLE` upgrades; launches at the current schema version skip the base statements and reinstall follow-up history/invariant triggers. Treat shipped migrations as immutable; add new ones rather than editing.
- **Never log applicant PII** (email, phone, SSN) — submission metadata only.
- **Gmail setup:** user places `client_secrets.json` at `~/.jcc/gmail/client_secrets.json` (OAuth2 InstalledAppFlow, `gmail.send` scope only); token stored locally.
- **ATS notes:** Ashby supports an optional `api_key` constructor argument for a Basic authorization header, but startup constructs `AshbyAdapter()` without a key; no Ashby key field is wired in Settings → Credentials. Greenhouse GETs are public; POST may return 401/403 → `manual_required`. Workday/CAPTCHA pages return `manual_required`. Generic adapter uses heuristic label→input matching with Claude AI fallback; don't hardcode or cache selectors across navigations.

## Conventions

- TypeScript strict, functional components, hooks only (React Compiler handles memoization — no manual useMemo/useCallback). State: useState (component) → Zustand (global UI) → TanStack Query + SQLite (persistent).
- Rust commands defined via tauri-specta; `pnpm run rust:bindings` regenerates `src/lib/bindings.ts`; `src/lib/tauri-bindings.ts` wraps the generated commands. Playwright automation stays in the Python sidecar, never the Rust backend. Use tauri-specta commands/events, not Electron-style ipcMain/ipcRenderer.
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

Migration version tracking (#11) is implemented in `src-tauri/src/lib.rs`. Remaining backlog: shared `FieldMapper` across the 7 adapters (#12) · "Today" dashboard landing view (#13) · URL auto-detect on Add Job (#14) · tracker search/filter (#15) · bulk actions (#16) · CSV export (#17) · duplicate-URL detection (#18) · submission retry (#19) · macOS due-follow-up notifications (#20) · sidecar port-conflict diagnostic (#21). Post-v1.0 ideas: Lever adapter, Gmail inbox scanning, bulk LinkedIn import, Chrome extension, parallel Playwright sessions.

<!-- portfolio-context:start -->

# Portfolio Context

## What This Project Is

Job Command Center is a Tauri 2 desktop hub for an automated job-search pipeline. It tracks job listings, drives application submissions across ATS platforms and browser-automated portals, manages Gmail follow-ups, generates interview prep briefs, and reports pipeline analytics through a local app plus Python sidecar.

## Current State

The repo has moved beyond its template origin into a polished v1.0 posture with a documented v1.1 backlog. Phase 0 foundation is complete, and the product shape is centered on the tracker board, submission console, follow-up manager, interview prep, settings, and local sidecar lifecycle.

## Stack

- Tauri 2 desktop app with Rust backend and React 19 + TypeScript + Vite frontend
- shadcn/ui, Tailwind CSS, Zustand, TanStack Query, and tauri-specta bindings
- SQLite via sqlx and Rust migrations
- Python 3.12+ sidecar bundled with PyInstaller and exposed over local FastAPI
- Playwright, ATS API clients, Gmail API OAuth, Anthropic SDK, and macOS Keychain storage

## How To Run

- Use `pnpm`. This repo does not use `npm` — see the Gotchas section above.
- Run the app with the documented pnpm scripts from `package.json`.
- Run `pnpm run check:all` after significant changes.
- Ask the operator to run the dev server when interactive app feedback is needed.

## Known Risks

- Job-search, Gmail, ATS, profile, and credential data are sensitive; keep API keys in Keychain and Gmail OAuth files/browser profiles out of source.
- The Python sidecar is bundled and lifecycle-managed by the Rust backend; verify sidecar health after backend or packaging changes.
- Browser automation for LinkedIn, Indeed, Gem, Workday, and generic ATS flows is fragile and should be tested with real fixtures before shipping.

## Next Recommended Move

Use `pnpm run check:all` and targeted sidecar health checks before changing submission automation, Gmail follow-up, or credential behavior.

<!-- portfolio-context:end -->

<!-- secondbrain-breadcrumb -->

## SecondBrain knowledge vault

Prior lessons, decisions, and context for this project live in SecondBrain at `wiki/maps/projects/job-command-center.md`. The whole vault is searchable via the `engraph` MCP — query it for this project + its stack before non-trivial work.
