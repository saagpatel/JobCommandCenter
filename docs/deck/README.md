# Demo Deck Outline

## Purpose

Use this outline to build a short demo deck after the screenshot capture pass. The deck should support a live walkthrough, not replace it.

## Suggested Slides

1. **Problem**: High-volume job searches scatter data across job boards, email, notes, resumes, and spreadsheets.
2. **Product**: Job Command Center centralizes tracking, submission prep, follow-ups, interview prep, and analytics.
3. **Local-First Architecture**: Tauri 2 desktop shell, Rust commands, SQLite via `sqlx`, Python sidecar, and Keychain credentials.
4. **Tracker Workflow**: Board, job detail panel, status movement, notes, and source metadata.
5. **Submission Workflow**: ATS adapters, browser automation, dry-run previews, and pause-before-submit safety.
6. **Follow-Up And Prep**: Gmail draft flow, interview prep briefs, and reminders.
7. **Analytics**: Weekly activity, funnel, response rate, and ATS breakdown.
8. **Security Posture**: Local data, Keychain credentials, scoped Tauri capabilities, CSP, and sanitized demo rules.
9. **Verification**: `pnpm run check:all`, `pnpm run build`, scanner output, and known release limits.
10. **Next Steps**: Screenshot capture, demo seed data, release runbook, signing/notarization evidence.

## Rehearsal Notes

- Keep the live demo on sanitized fixtures.
- Mention dry-run status before showing submission automation.
- Do not open real Gmail, Keychain, browser profiles, or local resume folders.
- Keep a fallback path: screenshots can carry the story if the live sidecar or browser automation is unavailable.
