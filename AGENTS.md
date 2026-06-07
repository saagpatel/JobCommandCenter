# AI Agent Instructions

## Overview

This repository is **Job Command Center** — a Tauri 2 desktop hub for an automated job-search pipeline (job tracker, ATS submission adapters, Gmail follow-ups, interview prep, analytics). Forked from dannysmith/tauri-template.

## First Read

- Read `docs/tasks.md` for task management.
- Review `docs/developer/architecture-guide.md` for high-level patterns.
- Check `docs/developer/README.md` for the full documentation index.
- Check git status and project structure before editing.
- Use `.codex/verify.commands` as the canonical verification source.

## Core Rules

- Use `pnpm`. This project does not use `npm`.
- Read files before editing and follow established repo patterns.
- Keep changes scoped to the requested task.
- Consider performance, maintainability, and testability for non-trivial changes.
- Match existing formatting and code style.
- Write meaningful tests for business logic.
- Run `pnpm run check:all` after significant changes when validation is approved.
- Do not start a dev server unless the user asks for it or says they will run it.
- Do not commit unless explicitly requested.
- Update relevant `docs/developer/` files when adding or changing durable patterns.
- Use Tauri v2 docs only.
- Use modern Rust formatting: `format!("{variable}")`.

## Architecture Guardrails

- State follows the onion model: component `useState`, global UI state in Zustand, persistent data through TanStack Query.
- Avoid Zustand destructuring that causes render cascades; use selectors and `getState()` where appropriate. See `docs/developer/state-management.md`.
- All user actions should flow through the command system. See `docs/developer/architecture-guide.md` and `docs/developer/command-system.md`.
- Rust and React communicate through typed Tauri commands and events.
- Use typed commands from `@/lib/tauri-bindings`; do not use string-based `invoke` directly for app commands.
- Keep UI strings in `/locales/*.json` and use CSS logical properties for RTL support. See `docs/developer/i18n-patterns.md`.

## Static Analysis And Quality

- `pnpm run check:all` is the main quality gate.
- `check:all` includes TypeScript, ESLint, ast-grep, Prettier check, Rust fmt/clippy, Vitest, and Rust tests.
- React Compiler handles memoization; do not add manual `useMemo`, `useCallback`, or `React.memo` unless there is a clear local reason.
- ast-grep enforces architecture patterns such as no Zustand destructuring.
- knip and jscpd are periodic cleanup tools, not part of `check:all`.
- See `docs/developer/static-analysis.md` for details.

## Tauri And Rust

- Use Tauri v2 patterns.
- Add Rust commands through the documented tauri-specta flow.
- Regenerate and commit TypeScript bindings when command surfaces change.
- See `docs/developer/tauri-commands.md` and `docs/developer/rust-architecture.md`.

## Documentation

- Developer docs live under `docs/developer/`.
- Update docs when new patterns, systems, commands, or user-visible workflows are introduced.
- Claude Code-specific commands and agents are contextual tooling references, not universal Codex instructions. See `docs/developer/ai-tooling.md`.

## Codex App Usage

- Use Codex App Projects for repo-specific implementation, review, and verification in this checkout.
- Use a Worktree when the task changes core architecture, command wiring, Rust/Tauri boundaries, or multiple docs/code surfaces at once.
- Use the in-app browser or Playwright for UI workflows, responsive behavior, accessibility, and visual checks.
- Use computer use only for GUI-only desktop behavior that cannot be verified through tests, browser tooling, MCP, or CLI commands.
- Use artifacts for durable developer notes, screenshots, release packets, and handoff summaries.
- Keep connectors read-first and task-scoped. Do not pull external context unless it directly supports the current repo task.
- Keep `.codex/verify.commands` and `pnpm run check:all` as the verification authority; Codex App tools add evidence but do not replace the repo gate.

## Verification

- `.codex/verify.commands` is the canonical verifier for routine Codex work.
- Current canonical verifier:
  - `pnpm install --frozen-lockfile`
  - `pnpm run check:all`
  - `pnpm run build`
- If a command is missing, unclear, or unsafe to run, stop and report the blocker instead of guessing.

## Boundaries

- Do not broaden scope into unrelated cleanup.
- Do not run destructive commands without explicit approval.
- Do not change package managers.
- Do not touch secrets, credentials, `.env` files, OAuth files, or build artifacts unless explicitly requested.

<!-- secondbrain-breadcrumb -->

## SecondBrain knowledge vault

Prior lessons, decisions, and context for this project live in SecondBrain at `wiki/maps/projects/job-command-center.md`. The whole vault is searchable via the `engraph` MCP — query it for this project + its stack before non-trivial work.
