# Job Command Center Demo Plan

## Purpose

Use this plan for local, sanitized demos of Job Command Center. The demo should show the product workflow without exposing real job applications, Gmail data, API keys, resumes, or browser session state.

## Demo Safety Rules

- Use fictional companies, roles, contacts, salaries, and application URLs.
- Do not connect a real Gmail account during a public or portfolio demo.
- Do not show Keychain prompts, API keys, OAuth files, `.env` files, or real local paths.
- Use dry-run submission paths for ATS and browser automation.
- Pause before any external browser submission step.
- Treat screenshots in `docs/screenshots/` as evidence of UI states, not proof that external ATS submissions were completed.

## Baseline Scenario

1. Open the tracker board with seeded sample jobs across Saved, Applied, Interviewing, Offer, and Rejected.
2. Add a fictional job from a fictional company and confirm it appears on the board.
3. Open the job detail panel and review notes, source URL, resume path, and submission history.
4. Run a dry-run submission preview for an ATS adapter.
5. Open follow-up manager and show a generated draft in pending state.
6. Move a job to Interviewing and show interview-prep brief generation or a saved sample brief.
7. Open analytics and show the weekly applications, pipeline funnel, response rate, and ATS breakdown.
8. Open settings and show credentials status without revealing secrets.
9. Trigger the quick pane and command palette to show desktop workflow ergonomics.

## Evidence To Capture

- Tracker board populated with sanitized jobs.
- Add job modal with fictional data.
- Submission console in dry-run mode.
- Follow-up draft with fictional recipient and content.
- Interview prep brief with fictional company data.
- Analytics dashboard with seeded sample counts.
- Settings credentials panel showing safe status only.
- Quick pane and command palette.

## Verification Notes

Before using this demo externally, run:

```bash
pnpm run check:all
pnpm run build
```

Record what was not verified, especially Apple signing/notarization, real Gmail OAuth, real ATS submission, and external browser automation against production sites.
