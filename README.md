# Job Command Center

[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript)](#) [![Rust](https://img.shields.io/badge/Rust-dea584?style=flat-square&logo=rust)](#) [![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#)

JobCommandCenter is a Tauri 2 desktop application for automating a job-search pipeline. It tracks job listings on a Kanban board, automates application submissions across ATS platforms (Ashby and Greenhouse via API; LinkedIn, Indeed, Gem, Workday, and Generic via Playwright), manages follow-up emails via Gmail, generates interview prep briefs with Claude AI, and reports pipeline analytics. A Python sidecar (FastAPI) handles browser automation and external API calls; the Rust backend manages SQLite persistence and credential storage.

Ships with Claude Code integration — custom commands, specialized agents, and architecture docs.

## What's Built

### Job Search Pipeline

- **Job Tracker** — Kanban board with drag-and-drop columns (Applied, Phone Screen, Interview, Offer, etc.) and a detail panel for notes and status history
- **Submission Console** — batch ATS submission with real-time SSE progress; API-direct for Ashby/Greenhouse, Playwright-headed for LinkedIn, Indeed, Gem, Workday, and Generic
- **Follow-up Manager** — email follow-up queue with Gmail OAuth2 send; auto-drafts via Claude AI
- **Interview Prep** — per-job notes and AI-generated briefs using claude-sonnet-4-6
- **Analytics** — pipeline funnel, response rates, and submission history charts
- **Settings** — applicant profile, per-platform credentials (stored in macOS Keychain), and ATS platform configuration

### Desktop Infrastructure

- **Command Palette** (`Cmd+K`) — searchable launcher with keyboard navigation
- **Quick Pane** (`Cmd+Shift+.`) — floating overlay window that works above fullscreen apps via NSPanel on macOS
- **Native Menus** — App, View menus with full i18n support
- **Preferences System** — settings dialog with Rust-side persistence and type-safe access
- **Theme System** — light/dark with system preference detection, synced across all windows
- **Auto-updates** — Tauri updater configured with GitHub Releases integration
- **Crash Recovery** — emergency data persistence for recovering unsaved work
- **Collapsible Sidebars** — resizable panels with state persistence
- **Structured Logging** — consistent utilities for both Rust and TypeScript sides

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+ (`npm install -g pnpm`)
- Rust stable toolchain (`rustup`)
- Python 3.12+ with `uv` or `pip`
- Playwright Chromium: `playwright install chromium` (one-time)
- Tauri system dependencies: [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

### Installation

```bash
git clone https://github.com/saagpatel/JobCommandCenter
cd JobCommandCenter
pnpm install
```

### Usage

```bash
# Start in development mode (Rust + React + sidecar)
pnpm tauri:dev

# Frontend only (no Rust, no sidecar — for UI work)
pnpm dev

# Full quality gate (TypeScript, ESLint, ast-grep, clippy, tests)
pnpm run check:all
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 |
| Frontend | React 19, TypeScript, Vite 7 |
| UI | shadcn/ui v4, Tailwind CSS v4, Lucide React |
| State | Zustand v5, TanStack Query v5 |
| Type-safe bridge | `tauri-specta` (generates TS bindings from Rust) |
| Database | SQLite via sqlx (Rust-side migrations) |
| Credential storage | macOS Keychain via `keyring` (Rust + Python) |
| i18n | i18next + react-i18next (RTL supported) |
| Quality | ESLint, Prettier, ast-grep, knip, jscpd, clippy |
| Testing | Vitest v4, Testing Library, pytest |
| Sidecar | Python 3.12, FastAPI, uvicorn (port 9876) |
| Browser automation | Playwright (headed Chromium, persistent profiles) |
| AI | Anthropic SDK — claude-sonnet-4-6 |
| Email | Google API Python Client — Gmail OAuth2 |

## Architecture

Three-layer state model: `useState` for component-local state, Zustand for global UI state, TanStack Query for SQLite-persisted data. All Rust commands are typed via `tauri-specta` — TypeScript bindings are generated from Rust function signatures at build time. A Python sidecar (FastAPI on localhost:9876) handles browser automation and external API calls; the Rust backend spawns and health-checks it at startup.

## License

MIT
