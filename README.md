# Job Command Center

A Tauri 2 desktop hub for an automated job-search pipeline. Tracks job listings, drives application submissions across ATS platforms (Ashby, Greenhouse) and browser-automated portals (LinkedIn, Indeed, Gem, Workday), manages Gmail follow-ups, generates interview-prep briefs, and reports pipeline analytics.

## Stack

| Layer    | Technologies                                    |
| -------- | ----------------------------------------------- |
| Frontend | React 19, TypeScript, Vite 7                    |
| UI       | shadcn/ui v4, Tailwind CSS v4, Lucide React     |
| State    | Zustand v5, TanStack Query v5                   |
| Desktop  | Tauri v2, Rust, SQLite (sqlx)                   |
| Sidecar  | Python 3.12, FastAPI (port 9876)                |
| Testing  | Vitest v4, Testing Library, pytest              |
| Quality  | ESLint, Prettier, ast-grep, knip, jscpd, clippy |

## What's Built (v1.0)

### Job Tracking

- **Tracker Board** — Kanban board with drag-and-drop across Saved, Applied, Interviewing, Offer, and Rejected columns.
- **Job Detail Panel** — Per-job notes, submission history, file links, and follow-up timeline.
- **Add Job Modal** — Company, role, ATS type, apply URL, tier, and source.

### Application Submission

- **Ashby adapter** — API-direct submission with dry-run preview and field mapping.
- **Greenhouse adapter** — API-direct submission with automatic field detection.
- **LinkedIn Easy Apply** — Playwright automation with AI-assisted field mapping and pause-before-submit.
- **Indeed, Gem, Workday, Generic adapters** — Playwright form automation with CAPTCHA-pause mode.
- **Submit Console** — Batch submission UI with real-time SSE streaming and per-job status.

### Intelligence

- **Follow-up Manager** — Auto-schedules follow-ups at +7 days after Apply, drafts via Claude AI, sends via Gmail OAuth.
- **Interview Prep** — AI-generated brief (company overview, likely questions, talking points) auto-triggered on status → Interviewing.
- **Analytics Dashboard** — Applications by week, pipeline funnel, response rate, days-to-response, ATS breakdown.

### Infrastructure

- **Python sidecar** — FastAPI on `127.0.0.1:9876`, started and health-monitored by the Rust backend. Hosts the submission engine, Playwright sessions, Gmail OAuth, and Anthropic SDK.
- **Credentials vault** — ATS credentials and API keys stored in macOS Keychain.
- **Profile management** — Contact info and resume path used to pre-fill submission forms.
- **Command Palette** (`Cmd+K`), **Quick Pane** (`Cmd+Shift+.`), theme, preferences, native menus, and an opt-in updater flow.

## Getting Started

### Prerequisites

- Node.js 20+ and pnpm
- Rust (latest stable) — [rustup.rs](https://rustup.rs/)
- Python 3.12+

```bash
# Install JS dependencies
pnpm install

# Install Python sidecar
cd sidecar && pip install -e ".[test]" && cd ..

# One-time: install Playwright browser
playwright install chromium

# Run quality gate
pnpm run check:all
```

Ask the operator to start the dev server (`pnpm run tauri:dev`) when interactive feedback is needed.

### Credentials Setup

- **Anthropic API key** — Settings → Credentials (stored in macOS Keychain)
- **Ashby API key** — Settings → Credentials (stored in macOS Keychain)
- **Gmail** — Place `client_secrets.json` at `~/.jcc/gmail/client_secrets.json` (OAuth2, `gmail.send` scope)

## Documentation

- **[Developer Docs](docs/developer/)** — Architecture, patterns, and detailed guides
- **[User Guide](docs/userguide/)** — End-user documentation
- **[LinkedIn Bot Detection](docs/LINKEDIN-BOT-DETECTION.md)** — Notes on handling LinkedIn automation challenges
- **[Changelog](CHANGELOG.md)** — Release history

## License

[MIT](LICENSE.md)

---

Built with [Tauri](https://tauri.app) | [shadcn/ui](https://ui.shadcn.com) | [React](https://react.dev)
