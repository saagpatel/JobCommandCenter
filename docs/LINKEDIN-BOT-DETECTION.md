# LinkedIn Bot-Detection Behavior

How JCC's LinkedIn adapter avoids triggering LinkedIn's anti-automation
detection, what's known to trigger detection anyway, and what's not handled.

> **Authoritative source:** `sidecar/src/adapters/linkedin.py` is the
> implementation. This doc captures the operator-visible behavior, what's
> guarded against, and what gaps remain.

---

## How JCC avoids detection

### 1. Persistent real-browser session (not headless scraping)

The adapter never logs in programmatically. It reuses a Playwright browser
context (`pw_manager.get_context("linkedin")`) that the operator pre-logged
into via **Settings → Platforms → LinkedIn → Login**. That login is done in
a visible Chromium window where the operator solves any 2FA / CAPTCHA / device
verification challenge themselves. The resulting cookies + storage state
persist on disk.

Effect: LinkedIn sees a normal logged-in browser. The fingerprint is real
Chromium (not headless Chrome, not requests/httpx).

Profile files alone are not proof of authentication. JCC records a successful
visible login, but after every app restart the saved profile is shown as
**Verification required** until LinkedIn redirects to its authenticated feed.
The adapter refuses to submit unless that verification happened in the current
app run:

```python
if self._pw_manager and not self._pw_manager.session_authenticated("linkedin"):
    errors.append("LinkedIn session is not verified. Verify it first via Settings > Platforms.")
```

Job URLs are parsed and checked against the exact HTTPS `linkedin.com` origin
before a browser is opened. Lookalike hosts, embedded credentials, nonstandard
ports, and insecure URLs are rejected. Every post-click transition is checked
again; a login or checkpoint redirect revokes verification, while navigation
outside LinkedIn stops as a manual handoff.

The persistent browser context blocks service workers and intercepts initial
top-level requests. A Chromium response-stage guard separately checks each HTTP
redirect before the next destination is requested. External redirect targets
are aborted; trusted in-page redirect chains continue. All popup and new-window
requests stop for manual handoff because their response guard cannot be
attached safely before the first navigation. Ordinary page assets and iframe
content continue to load. Manual-handoff evidence strips credentials, query
parameters, and fragments from the destination URL.

### 2. Hard rate limits (session-level)

| Limit                   | Value | Effect                                     |
| ----------------------- | ----- | ------------------------------------------ |
| `_MAX_PER_SESSION`      | 10    | App must be restarted after 10 submissions |
| `_MIN_INTERVAL_SECONDS` | 180   | Forced 3-minute wait between submissions   |

Both checks return `SubmissionResult(status="failed", error="…")` before any
browser action runs. Volume-based detection has an explicit ceiling.

### 3. Randomized inter-action delays

Every Playwright interaction is wrapped in `random_delay(min, max)`:

| Action                     | Delay      |
| -------------------------- | ---------- |
| After page navigation      | `1.0–2.0s` |
| Before clicking Easy Apply | `0.3–0.8s` |
| After clicking Easy Apply  | `1.0–2.0s` |
| Between modal steps        | `0.5–1.0s` |
| After file upload          | `1.0–2.0s` |
| After Submit click         | `2.0–3.0s` |

No back-to-back synthetic clicks; cadence resembles a slow human.

### 4. Easy Apply only — native LinkedIn flow

The adapter targets `button:has-text("Easy Apply")` and drives LinkedIn's
own multi-step modal. It does not scrape application URLs on external ATS
domains. Using LinkedIn's native flow keeps interactions on first-party
endpoints LinkedIn expects bots to use legitimately (e.g., Microsoft / Indeed
job aggregators also hit Easy Apply).

### 5. Real DOM interactions

- File upload via `input[type="file"]` (`upload_file` helper) — same as a
  human picking a file.
- `fill_field` for text inputs.
- `select_option` for selects.

No JavaScript injection, no `Element.click()` via evaluate, no XHR
fabrication.

### 6. Failure evidence captured (debugging, not evasion)

`screenshot_on_failure(page, …)` captures the page state when:

- The adapter exhausts `max_steps = 10` without reaching the Submit button.
- An exception bubbles up (e.g., a selector wasn't found).

This is for the operator's post-hoc diagnosis. It doesn't change LinkedIn's
detection surface — but it makes "what tripped the flow" knowable.

---

## What's known to still trigger detection

These are NOT handled by the current adapter. If LinkedIn changes posture,
the adapter will hit failures here first.

### A. CAPTCHA / verification challenges mid-flow

If LinkedIn injects a verification challenge after the Easy Apply button is
clicked (e.g., "verify you're not a robot"), the adapter has no recognizer
and no handler. The flow will:

1. Time out waiting for the modal's expected `div[role="dialog"]`, OR
2. Find the modal but exhaust `max_steps` without reaching Submit, OR
3. Throw an exception when a Continue/Submit selector isn't found.

A `screenshot_on_failure` capture will show the CAPTCHA. Recovery: operator
re-logs in and solves the CAPTCHA in the visible browser; that re-validates
the session.

### B. Browser fingerprint reuse across operators

Playwright defaults to a recognizable Chromium build. Multiple JCC users on
multiple machines all present similar fingerprints. LinkedIn may correlate
these. The adapter doesn't customize:

- User-Agent
- WebGL / Canvas fingerprint
- Timezone / locale offsets
- Hardware fingerprint (`navigator.hardwareConcurrency`, etc.)

Mitigation today: rely on session cookies being long-lived and the per-account
rate limits keeping volume below LinkedIn's per-account thresholds.

### C. DOM drift

LinkedIn updates the Easy Apply modal DOM frequently. The adapter targets:

```
button:has-text("Easy Apply")
div[role="dialog"]
input[type="file"]
div[data-test-form-element]
label, legend, span.fb-dash-form-element__label
input, select, textarea
button[aria-label="Continue to next step"], button:has-text("Next")
button[aria-label="Review your application"], button:has-text("Review")
button[aria-label="Submit application"], button:has-text("Submit application")
```

Any of these changing will look like a stuck flow rather than a detection
event. Diagnose via the failure screenshot.

### D. Volume across long horizons

`_MAX_PER_SESSION = 10` resets when the app restarts. Nothing stops the
operator from restarting 10 times in an hour. LinkedIn's account-level rate
limits will catch that — JCC's per-session limits won't.

### E. Account behavioral signals JCC doesn't simulate

- No mouse movement traces.
- No scroll events.
- No idle pauses mid-modal as a real user would re-read a question.

These are detectable by sophisticated bot detection (e.g., behavioral
biometrics). The 0.5–2s `random_delay` between actions does not simulate
intra-action human variance.

---

## Operator playbook

### Before a batch

1. Settings → Platforms → LinkedIn → confirm **Connected**.
2. If **Verification required**, click **Verify session**. Complete login in
   the visible browser if LinkedIn asks (including CAPTCHAs/2FA). The browser
   profile persists, but JCC re-verifies it once per app run.
3. Check `_submission_count` is fresh (app restart resets it).

### During a batch

1. Don't restart the app between submissions just to reset the counter.
   That's the rate limit doing its job.
2. Watch for screenshot files in the configured failures directory — those
   are real signals worth investigating.
3. If multiple submissions fail in a row with "stuck without Submit", check
   the most recent failure screenshot. It usually shows either a DOM change
   or a verification challenge.

### After a batch

1. Review the submission log. `status="success"` requires the confirmation
   text "submitted" or "Application submitted" to appear within 10 seconds
   of the Submit click. If `status="success"` but no real submission appears
   in LinkedIn's history → likely LinkedIn silently dropped it (rare; check
   for shadow-banning).
2. If many `status="failed"` with `error="Exhausted maximum steps…"`, expect
   DOM drift. Compare the failure screenshot to a manual Easy Apply session.

### When LinkedIn changes the game

1. Stop the batch.
2. Manually run Easy Apply on one job to confirm the new flow.
3. Diff the selectors in `sidecar/src/adapters/linkedin.py` against what you
   observe.
4. Update selectors, re-run a dry-run (`status="dry_run"`), then a small live
   batch.

---

## Not in scope today (future work)

- 2FA recovery in-flow (currently requires operator to re-log via Settings).
- CAPTCHA detection + escalation (currently dies silently with a screenshot).
- Browser fingerprint randomization.
- Per-day quota beyond per-session.
- Behavioral biometric simulation.

If LinkedIn detection becomes a real problem at the current usage volume,
priority order would be: CAPTCHA detection → fingerprint customization →
intra-action humanization. Per-session rate limits are already conservative.
