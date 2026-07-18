# Job Command Center — User Guide

## Getting Started

Job Command Center is a desktop app for automating your job search. It tracks applications on a Kanban board, submits to ATS platforms automatically, drafts follow-up emails, generates interview prep briefs, and shows pipeline analytics.

## Navigation

The left sidebar has six views, each reachable by keyboard shortcut:

| Shortcut | View              |
| -------- | ----------------- |
| Cmd+1    | Tracker           |
| Cmd+2    | Submit Console    |
| Cmd+3    | Follow-up Manager |
| Cmd+4    | Interview Prep    |
| Cmd+5    | Analytics         |
| Cmd+6    | Settings          |

Toggle the sidebars: **Cmd+[** (left) / **Cmd+]** (right).

## Keyboard Shortcuts

### Global

| Action          | Mac          | Windows/Linux |
| --------------- | ------------ | ------------- |
| Command Palette | Cmd+K        | Ctrl+K        |
| Preferences     | Cmd+,        | Ctrl+,        |
| Quick Pane      | Configurable | Configurable  |

## Tracker

The Tracker is your Kanban board. Jobs move through five columns: **Saved → Applied → Interviewing → Offer → Rejected**.

- **Add a job**: click the + button or use the Command Palette.
- **Move a job**: drag its card to a new column. Status updates automatically.
- **Job detail**: click a card to open the detail panel — edit notes, view submission history, open the resume file, and see the follow-up timeline.
- **Archive**: drag to Rejected or use the card menu to archive.

## Submit Console

Select jobs from the Tracker and submit them in batch.

1. Check the boxes on one or more Saved or Applied jobs.
2. Click **Dry Run** to preview the field mapping and catch warnings without submitting.
3. Click **Submit Selected** to submit. Progress streams in real time per job.
4. Results show green (success), yellow (manual action required), or red (failed).
5. On success the job status moves to Applied automatically and a follow-up is scheduled.

### ATS Adapters

| Platform   | Method     | Notes                                                           |
| ---------- | ---------- | --------------------------------------------------------------- |
| Ashby      | API        | Requires Ashby API key in Settings → Credentials                |
| Greenhouse | API        | Public GETs; POST may require API key                           |
| LinkedIn   | Playwright | Login first in Settings → Platforms; pauses before final submit |
| Indeed     | Playwright | Login first in Settings → Platforms                             |
| Gem        | Playwright | Standard form fill                                              |
| Workday    | Playwright | Multi-page flow; returns manual_required on CAPTCHA             |
| Generic    | Playwright | Heuristic label matching with Claude AI fallback                |

## Follow-up Manager

Follow-ups are auto-created when a job moves to Applied (+7 days by default).

1. Open **Follow-up Manager** (Cmd+3).
2. Click a pending follow-up to see the AI-drafted email (subject + body).
3. Edit the draft inline if needed, or click **Regenerate** for a new draft.
4. Click **Send** to dispatch via Gmail. The job's detail timeline updates.
5. Click **Skip** to dismiss without sending.

Draft-generated, draft-saved, and snoozed confirmations appear only after the
tracker has saved the change. If saving fails, JCC keeps the action unconfirmed
and shows an error instead of a success message.

If the follow-up schedule cannot be read from the database, JCC shows a load
error instead of an empty schedule. Use **Retry** after the database is
available.

If follow-ups load but their job details do not, JCC keeps the lifecycle rows
visible, labels their company and role context as unavailable, and offers
**Retry job details**.

While job details are still loading, the row says so instead of showing an
unknown company. If a completed read confirms that the referenced job record is
missing, JCC identifies the broken reference and keeps lifecycle controls such
as **Snooze** and **Skip** available; AI draft generation remains disabled.

Each job can have only one active follow-up. Job Detail offers **Add** only when
no pending draft or unresolved send exists; resolve or skip the existing
follow-up before scheduling another.

Because terminal follow-up states cannot be reopened, JCC asks for confirmation
before **Skip** and **I verified it was sent**. Cancelling makes no change, and
failed database persistence leaves the obligation active.

**Gmail setup required**: place `client_secrets.json` at `~/.jcc/gmail/client_secrets.json` and authenticate via Settings → Credentials.

If a follow-up shows **Verify Send**, do not send it again. Check Gmail Sent,
then choose **I verified it was sent** or **I verified it was not sent**. This
state means Gmail or the tracker could not confirm the full send-and-receipt
sequence, so JCC blocks automatic retry to prevent a duplicate message. Job
Detail shows the same warning; select it there to open the recovery controls in
Follow-up Manager. Unresolved sends remain visible under **All Pending** and are
counted separately as **verify send** work in the manager summary.

Because **I verified it was not sent** re-enables sending, JCC asks for
confirmation before returning the message to its draft. Cancelling keeps the
send blocked. The retry becomes available only after the database accepts the
recovery change; a failed save leaves the follow-up in **Verify Send**.

Expand a follow-up to see **Activity history**. JCC records each status change
with its time and cause, including send attempts, Gmail acceptance, manual
verification, and skips. Records that existed before history tracking show an
honest migration baseline rather than reconstructed events.

Job Detail shows the same activity across all follow-ups for that job,
including skipped follow-ups that no longer appear as active cards. A load
error is shown explicitly instead of being presented as an empty history.

## Interview Prep

A brief is auto-generated when a job status moves to **Interviewing**.

- Open **Interview Prep** (Cmd+4) and select a job.
- The brief covers company overview, recent news, likely questions, talking points, and red flags to probe.
- Edit the notes section below the brief for your own additions.
- Click **Regenerate** to get a fresh brief from Claude AI.

## Analytics

Open **Analytics** (Cmd+5) for a visual overview of your pipeline:

- Applications by week (bar chart)
- Pipeline funnel: Saved → Applied → Interviewing → Offer
- Response rate and average days to first response
- Submissions by ATS platform (pie chart)
- Tier 1 vs Tier 2 comparison

## Settings

Open **Settings** (Cmd+6) for three tabs:

### Profile

Name, contact info, LinkedIn URL, location, authorization status, and base resume path. This data pre-fills submission forms.

### Credentials

- **Anthropic API key** — used for follow-up drafts and interview prep briefs.
- **Ashby API key** — required for Ashby submissions.
- **Gmail** — authenticate OAuth to enable follow-up sending.

All secrets are stored in macOS Keychain, never on disk.

### Platforms

Log in to LinkedIn and Indeed to enable Playwright sessions. Browser profiles
persist across app restarts, but JCC requires **Verify session** once per app
run before enabling submissions. LinkedIn and Indeed automation accepts only
trusted HTTPS platform origins; external ATS redirects stop with a manual
handoff instead of continuing automation. JCC blocks untrusted top-level and
HTTP-redirect destinations before contact. Any popup or new window stops for a
manual handoff, even when its first URL is on the platform, because automation
cannot safely inspect its redirect chain before loading it. Handoff messages
omit URL query data.

## Global Features

### Command Palette

Press **Cmd+K** to open the command palette — search and trigger any action.

### Quick Pane

A floating window summoned by a global shortcut (configurable in Preferences → Keyboard Shortcuts), available even when the app is in the background or another app is fullscreen.

### Preferences

Press **Cmd+,** to set theme (Light / Dark / System), language, and keyboard shortcuts.

### Auto-updates

Release builds check for updates on launch only when automatic checks were
enabled during the signed release build. Those builds also provide App menu →
Check for Updates; updater-disabled builds make no update endpoint contact.
