# One-Pager Outline

## Product Summary

Job Command Center is a local-first Tauri desktop hub for managing an automated job-search pipeline: tracking applications, preparing ATS submissions, drafting Gmail follow-ups, generating interview prep, and reviewing pipeline analytics.

## Audience

- Operator running a high-volume job search.
- Reviewer evaluating local-first desktop product quality.
- Developer maintaining the Tauri, Rust, React, Python sidecar, and SQLite stack.

## Key Value

- Centralizes job tracking, follow-ups, interview prep, and analytics in one desktop app.
- Keeps credentials in macOS Keychain and job data in local SQLite.
- Uses dry-run and pause-before-submit behavior for safer automation demos.
- Provides desktop workflow affordances: command palette, quick pane, native menus, notifications, and updater flow.

## Proof Points

- Tauri 2 + Rust backend with typed command bindings.
- SQLite via `sqlx` with WAL, foreign keys, busy timeout, and startup migrations.
- Python FastAPI sidecar for submission automation and external API integrations.
- `pnpm run check:all` covers TypeScript, ESLint, ast-grep, Prettier, Rust fmt/clippy, Vitest, and Rust tests.

## Current Demo Limits

- Real Gmail OAuth should not be shown in public demos.
- Real ATS submission should remain dry-run or pause-before-submit.
- Apple signing, notarization, and external updater distribution require separate release evidence.
