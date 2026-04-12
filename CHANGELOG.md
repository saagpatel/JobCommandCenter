# Changelog

All notable changes to Job Command Center are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2026-04-12

### Added

- **Job tracker** — Kanban board with drag-and-drop cards for tracking applications across pipeline stages (Applied, Screening, Interview, Offer, Rejected). Create, edit, and delete jobs directly on the board.
- **Ashby integration** — Automatically fetch job postings, map application fields, and submit directly via the Ashby API.
- **Greenhouse integration** — Submit applications to Greenhouse ATS with automatic field detection and form-filling.
- **LinkedIn Easy Apply** — Browser-based LinkedIn Easy Apply automation with AI-assisted field mapping via Claude.
- **Indeed, Gem, Workday, and Generic browser adapters** — Playwright-powered form automation for four additional platforms; falls back to a generic adapter for any ATS not explicitly supported.
- **Batch submission console** — Stream real-time submission progress across multiple platforms simultaneously with live status updates per application.
- **Follow-up email pipeline** — Automatically drafts follow-up emails using Claude AI after configurable waiting periods and sends them via Gmail.
- **Interview prep briefs** — One-click AI-generated interview preparation brief for any job in your pipeline, rendered as formatted Markdown.
- **Analytics dashboard** — Visual overview of your job search: applications by week, pipeline funnel, response rate, average days to first response, and submissions by platform.
- **Sidebar badges** — At-a-glance counts for follow-ups due and interview prep needed, always visible in the navigation sidebar.
- **Keyboard shortcuts** — Cmd+1–6 to jump between views; Cmd+[ / Cmd+] to toggle sidebars.
- **Profile management** — Store your name, contact info, resume path, and target role in a persistent profile used to pre-fill application forms.
- **Credentials vault** — Securely store ATS platform credentials and API keys using the macOS Keychain.
- **Configurable follow-up interval** — Set how many days to wait before a follow-up reminder appears, per job or globally in Settings.
- **Personal notes** — Attach free-form notes to any job for interview prep, salary negotiation reminders, or recruiter context.

### Fixed

- Deleting a job now also removes all associated submissions, follow-ups, and notes — no orphaned data left behind.
- Gmail authentication tokens are stored with owner-only file permissions, preventing other users or processes from reading your OAuth credentials.
- Stale Gmail tokens are automatically refreshed rather than producing a silent authentication failure.

### Security

- Updated dependencies to resolve five security advisories, including a Starlette denial-of-service vulnerability and a cryptography library name-constraint bypass.
- Sensitive files (`.env`, `token.json`, `client_secrets.json`, Playwright session data) are excluded from version control.
