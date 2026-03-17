from __future__ import annotations

import time
import uuid

import structlog

from src.adapters.base import BaseAdapter
from src.api.models import ApplicantProfile, JobListing, SubmissionResult
from src.services.claude_ai import ClaudeAIService
from src.services.playwright_base import (
    PlaywrightManager,
    click_button,
    fill_field,
    random_delay,
    screenshot_on_failure,
    select_option,
    upload_file,
)
from src.utils.files import expand_path, validate_file

logger = structlog.get_logger(__name__)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class LinkedInAdapter(BaseAdapter):
    _MAX_PER_SESSION = 10
    _MIN_INTERVAL_SECONDS = 180  # 3 minutes between submissions

    def __init__(
        self,
        pw_manager: PlaywrightManager | None = None,
        claude_service: ClaudeAIService | None = None,
    ) -> None:
        self._pw_manager = pw_manager
        self._claude_service = claude_service
        self._submission_count: int = 0
        self._last_submission_time: float = 0

    @property
    def name(self) -> str:
        return "linkedin"

    async def validate(self, job: JobListing) -> list[str]:
        errors: list[str] = []

        if job.ats != "linkedin":
            errors.append(f"Expected ats='linkedin', got '{job.ats}'")

        if "linkedin.com" not in (job.apply_url or ""):
            errors.append("apply_url does not contain linkedin.com")

        resume = job.resume_path
        if resume:
            valid, reason = validate_file(expand_path(resume))
            if not valid:
                errors.append(f"Resume: {reason}")
        else:
            errors.append("No resume_path provided")

        if self._pw_manager and not self._pw_manager.session_exists("linkedin"):
            errors.append("No LinkedIn session found. Please log in first via Settings > Platforms.")

        return errors

    async def submit(
        self,
        job: JobListing,
        profile: ApplicantProfile,
        dry_run: bool,
    ) -> SubmissionResult:
        start = time.monotonic()
        job_id = str(uuid.uuid4())

        # Rate limiting checks
        if self._submission_count >= self._MAX_PER_SESSION:
            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=False,
                cover_letter_uploaded=False,
                error=f"Session limit reached ({self._MAX_PER_SESSION} submissions). Restart the app to reset.",
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        elapsed = time.monotonic() - self._last_submission_time
        if self._last_submission_time > 0 and elapsed < self._MIN_INTERVAL_SECONDS:
            wait_time = int(self._MIN_INTERVAL_SECONDS - elapsed)
            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=False,
                cover_letter_uploaded=False,
                error=f"Rate limit: wait {wait_time} seconds before next submission.",
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        if self._pw_manager is None:
            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=False,
                cover_letter_uploaded=False,
                error="PlaywrightManager not initialized",
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        page = None
        resume_uploaded = False
        fields_filled: list[str] = []
        fields_skipped: list[str] = []

        try:
            ctx = await self._pw_manager.get_context("linkedin")
            page = await ctx.new_page()
            await page.goto(job.apply_url, wait_until="domcontentloaded")
            await random_delay(1.0, 2.0)

            # Click Easy Apply button
            easy_apply_btn = page.locator('button:has-text("Easy Apply")')
            await easy_apply_btn.wait_for(timeout=10_000)
            await random_delay(0.3, 0.8)
            await easy_apply_btn.click()
            await random_delay(1.0, 2.0)

            # Process multi-step modal
            modal = page.locator('div[role="dialog"]')
            await modal.wait_for(timeout=10_000)

            max_steps = 10
            for step in range(max_steps):
                await random_delay(0.5, 1.0)

                # Check for resume upload opportunity
                resume_input = page.locator('input[type="file"]')
                if await resume_input.count() > 0 and not resume_uploaded:
                    resume_path = job.resume_path or (profile.base_resume_path or "")
                    if resume_path:
                        resolved = expand_path(resume_path)
                        await upload_file(page, 'input[type="file"]', resolved)
                        resume_uploaded = True
                        fields_filled.append("Resume")
                        await random_delay(1.0, 2.0)

                # Handle screening questions in current step
                question_groups = page.locator('div[data-test-form-element]')
                q_count = await question_groups.count()

                if q_count > 0:
                    questions_for_ai: list[dict[str, object]] = []

                    for i in range(q_count):
                        group = question_groups.nth(i)
                        label_el = group.locator("label, legend, span.fb-dash-form-element__label")
                        label_text = await label_el.first.text_content() if await label_el.count() > 0 else ""
                        label_text = (label_text or "").strip()

                        if not label_text:
                            continue

                        # Check for pre-filled or already answered
                        input_el = group.locator("input, select, textarea")
                        if await input_el.count() > 0:
                            current_val = await input_el.first.input_value()
                            if current_val and current_val.strip():
                                fields_filled.append(label_text)
                                continue

                        # Check custom_fields first
                        if label_text in job.custom_fields:
                            answer = str(job.custom_fields[label_text])
                            select_el = group.locator("select")
                            if await select_el.count() > 0:
                                await select_option(page, f"select", answer)
                            else:
                                text_input = group.locator("input, textarea")
                                if await text_input.count() > 0:
                                    await fill_field(page, f"input, textarea", answer)
                            fields_filled.append(label_text)
                            continue

                        # Collect for AI mapping
                        field_type = "text"
                        select_el = group.locator("select")
                        if await select_el.count() > 0:
                            field_type = "select"
                            options = []
                            option_els = select_el.first.locator("option")
                            for j in range(await option_els.count()):
                                opt_text = await option_els.nth(j).text_content()
                                if opt_text and opt_text.strip():
                                    options.append(opt_text.strip())
                            questions_for_ai.append({
                                "label": label_text,
                                "type": field_type,
                                "required": True,
                                "options": options,
                            })
                        else:
                            questions_for_ai.append({
                                "label": label_text,
                                "type": field_type,
                                "required": True,
                            })

                    # Use Claude AI for unmapped questions
                    if questions_for_ai and self._claude_service:
                        mapped = await self._claude_service.map_fields(
                            questions_for_ai, profile, job,
                        )
                        for q in questions_for_ai:
                            q_label = str(q["label"])
                            if q_label in mapped:
                                answer = mapped[q_label]
                                # Find the field again and fill it
                                for i in range(q_count):
                                    group = question_groups.nth(i)
                                    label_el = group.locator("label, legend, span.fb-dash-form-element__label")
                                    text = await label_el.first.text_content() if await label_el.count() > 0 else ""
                                    if (text or "").strip() == q_label:
                                        if q.get("type") == "select":
                                            sel = group.locator("select")
                                            if await sel.count() > 0:
                                                await select_option(page, "select", answer)
                                        else:
                                            inp = group.locator("input, textarea")
                                            if await inp.count() > 0:
                                                await inp.first.fill(answer)
                                        fields_filled.append(q_label)
                                        break
                            else:
                                fields_skipped.append(q_label)
                    elif questions_for_ai:
                        for q in questions_for_ai:
                            fields_skipped.append(str(q["label"]))

                # Look for Next/Review/Submit buttons
                next_btn = page.locator('button[aria-label="Continue to next step"], button:has-text("Next")')
                review_btn = page.locator('button[aria-label="Review your application"], button:has-text("Review")')
                submit_btn = page.locator('button[aria-label="Submit application"], button:has-text("Submit application")')

                if await submit_btn.count() > 0:
                    if dry_run:
                        screenshot_path = await screenshot_on_failure(page, f"linkedin_dry_run_{job.company}")
                        logger.info("dry run complete, screenshot saved", path=screenshot_path)
                        await page.close()
                        return SubmissionResult(
                            job_id=job_id,
                            company=job.company,
                            role=job.role,
                            adapter=self.name,
                            status="dry_run",
                            resume_uploaded=resume_uploaded,
                            cover_letter_uploaded=False,
                            fields_filled=fields_filled,
                            fields_skipped=fields_skipped,
                            error=None,
                            duration_seconds=time.monotonic() - start,
                            timestamp=_now_iso(),
                        )
                    else:
                        logger.warning("auto-submitting LinkedIn application", company=job.company, role=job.role)
                        await submit_btn.first.click()
                        await random_delay(2.0, 3.0)

                        # Wait for confirmation
                        confirmation = page.locator('h2:has-text("submitted"), div:has-text("Application submitted")')
                        try:
                            await confirmation.first.wait_for(timeout=10_000)
                        except Exception:
                            logger.warning("could not confirm submission success")

                        self._submission_count += 1
                        self._last_submission_time = time.monotonic()

                        await page.close()
                        return SubmissionResult(
                            job_id=job_id,
                            company=job.company,
                            role=job.role,
                            adapter=self.name,
                            status="success",
                            resume_uploaded=resume_uploaded,
                            cover_letter_uploaded=False,
                            fields_filled=fields_filled,
                            fields_skipped=fields_skipped,
                            error=None,
                            duration_seconds=time.monotonic() - start,
                            timestamp=_now_iso(),
                        )

                elif await review_btn.count() > 0:
                    await review_btn.first.click()
                    await random_delay(1.0, 2.0)
                elif await next_btn.count() > 0:
                    await next_btn.first.click()
                    await random_delay(1.0, 2.0)
                else:
                    # No navigation button found — maybe we're done or stuck
                    logger.warning("no navigation button found at step", step=step)
                    break

            # If we exhausted steps without submitting
            if page and not page.is_closed():
                screenshot_path = await screenshot_on_failure(page, f"linkedin_stuck_{job.company}")
                await page.close()

            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=resume_uploaded,
                cover_letter_uploaded=False,
                fields_filled=fields_filled,
                fields_skipped=fields_skipped,
                error="Exhausted maximum steps without reaching submit button",
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        except Exception as exc:
            logger.error("linkedin submission failed", error=str(exc), company=job.company, role=job.role)
            if page and not page.is_closed():
                try:
                    await screenshot_on_failure(page, f"linkedin_error_{job.company}")
                except Exception:
                    pass
                await page.close()
            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=resume_uploaded,
                cover_letter_uploaded=False,
                fields_filled=fields_filled,
                fields_skipped=fields_skipped,
                error=str(exc),
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )
