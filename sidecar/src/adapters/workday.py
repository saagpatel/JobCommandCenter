from __future__ import annotations

import time
import uuid

import structlog

from src.adapters.base import BaseAdapter
from src.api.models import ApplicantProfile, JobListing, SubmissionResult
from src.services.claude_ai import ClaudeAIService
from src.services.playwright_base import (
    PlaywrightManager,
    random_delay,
    screenshot_on_failure,
    upload_file,
)
from src.utils.files import expand_path, validate_file

logger = structlog.get_logger(__name__)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class WorkdayAdapter(BaseAdapter):
    def __init__(
        self,
        pw_manager: PlaywrightManager | None = None,
        claude_service: ClaudeAIService | None = None,
    ) -> None:
        self._pw_manager = pw_manager
        self._claude_service = claude_service

    @property
    def name(self) -> str:
        return "workday"

    async def validate(self, job: JobListing) -> list[str]:
        errors: list[str] = []

        if job.ats != "workday":
            errors.append(f"Expected ats='workday', got '{job.ats}'")

        if not (job.apply_url or ""):
            errors.append("apply_url is required")

        resume = job.resume_path
        if resume:
            valid, reason = validate_file(expand_path(resume))
            if not valid:
                errors.append(f"Resume: {reason}")
        else:
            errors.append("No resume_path provided")

        return errors

    async def submit(
        self,
        job: JobListing,
        profile: ApplicantProfile,
        dry_run: bool,
    ) -> SubmissionResult:
        start = time.monotonic()
        job_id = str(uuid.uuid4())

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
        cover_letter_uploaded = False
        fields_filled: list[str] = []
        fields_skipped: list[str] = []

        try:
            ctx = await self._pw_manager.get_context("workday")
            page = await ctx.new_page()
            await page.goto(job.apply_url, wait_until="domcontentloaded")
            await random_delay(1.5, 2.5)

            max_steps = 15
            for step in range(max_steps):
                await random_delay(0.5, 1.0)

                # Re-query locators fresh on every iteration (Workday rebuilds DOM)

                # --- CAPTCHA detection ---
                captcha = page.locator(
                    'iframe[src*="captcha"], div.g-recaptcha, #captcha'
                )
                if await captcha.count() > 0:
                    screenshot_path = await screenshot_on_failure(
                        page, f"workday_captcha_{job.company}"
                    )
                    logger.warning(
                        "CAPTCHA detected", company=job.company, path=screenshot_path
                    )
                    await page.close()
                    return SubmissionResult(
                        job_id=job_id,
                        company=job.company,
                        role=job.role,
                        adapter=self.name,
                        status="manual_required",
                        resume_uploaded=resume_uploaded,
                        cover_letter_uploaded=cover_letter_uploaded,
                        fields_filled=fields_filled,
                        fields_skipped=fields_skipped,
                        error="CAPTCHA detected — manual completion required",
                        duration_seconds=time.monotonic() - start,
                        timestamp=_now_iso(),
                    )

                # --- Sign In / Create Account ---
                sign_in_email = page.locator('[data-automation-id="email"]')
                sign_in_btn = page.locator('button:has-text("Sign In")')
                if await sign_in_email.count() > 0 or await sign_in_btn.count() > 0:
                    logger.info("workday sign-in page detected", step=step)
                    if await sign_in_email.count() > 0:
                        await sign_in_email.first.fill(profile.email)
                        fields_filled.append("email (sign-in)")
                    await page.close()
                    return SubmissionResult(
                        job_id=job_id,
                        company=job.company,
                        role=job.role,
                        adapter=self.name,
                        status="manual_required",
                        resume_uploaded=resume_uploaded,
                        cover_letter_uploaded=cover_letter_uploaded,
                        fields_filled=fields_filled,
                        fields_skipped=fields_skipped,
                        error="Workday account sign-in required — please log in manually",
                        duration_seconds=time.monotonic() - start,
                        timestamp=_now_iso(),
                    )

                # --- Review / Submit page ---
                review_heading = page.locator('h2:has-text("Review"), h1:has-text("Review")')
                submit_btn = page.locator(
                    'button[data-automation-id="bottom-navigation-next-button"]:has-text("Submit"), '
                    'button:has-text("Submit Application"), '
                    'button:has-text("Submit")'
                )
                if await review_heading.count() > 0 or await submit_btn.count() > 0:
                    if dry_run:
                        screenshot_path = await screenshot_on_failure(
                            page, f"workday_dry_run_{job.company}"
                        )
                        logger.info("dry run complete", path=screenshot_path)
                        await page.close()
                        return SubmissionResult(
                            job_id=job_id,
                            company=job.company,
                            role=job.role,
                            adapter=self.name,
                            status="dry_run",
                            resume_uploaded=resume_uploaded,
                            cover_letter_uploaded=cover_letter_uploaded,
                            fields_filled=fields_filled,
                            fields_skipped=fields_skipped,
                            error=None,
                            duration_seconds=time.monotonic() - start,
                            timestamp=_now_iso(),
                        )
                    else:
                        if await submit_btn.count() > 0:
                            logger.warning(
                                "auto-submitting Workday application",
                                company=job.company,
                                role=job.role,
                            )
                            await submit_btn.first.click()
                            await random_delay(2.0, 3.0)
                            try:
                                await page.wait_for_load_state(
                                    "networkidle", timeout=15_000
                                )
                            except Exception:
                                pass
                            await page.close()
                            return SubmissionResult(
                                job_id=job_id,
                                company=job.company,
                                role=job.role,
                                adapter=self.name,
                                status="success",
                                resume_uploaded=resume_uploaded,
                                cover_letter_uploaded=cover_letter_uploaded,
                                fields_filled=fields_filled,
                                fields_skipped=fields_skipped,
                                error=None,
                                duration_seconds=time.monotonic() - start,
                                timestamp=_now_iso(),
                            )

                # --- Documents / Resume upload ---
                file_upload_zone = page.locator(
                    '[data-automation-id="file-upload-drop-zone"]'
                )
                resume_label = page.locator(
                    'label:has-text("Resume"), p:has-text("Resume")'
                )
                file_inputs = page.locator('input[type="file"]')
                if (
                    await file_upload_zone.count() > 0
                    or await resume_label.count() > 0
                ) and await file_inputs.count() > 0:
                    if not resume_uploaded and job.resume_path:
                        resolved = expand_path(job.resume_path)
                        await upload_file(page, 'input[type="file"]', resolved)
                        resume_uploaded = True
                        fields_filled.append("Resume")
                        await random_delay(1.0, 2.0)

                    # Upload cover letter if a second file input is present
                    if (
                        not cover_letter_uploaded
                        and job.cover_letter_path
                        and await file_inputs.count() > 1
                    ):
                        cl_resolved = expand_path(job.cover_letter_path)
                        second_input = file_inputs.nth(1)
                        await second_input.set_input_files(cl_resolved)
                        cover_letter_uploaded = True
                        fields_filled.append("Cover Letter")
                        await random_delay(1.0, 2.0)

                    await _click_continue(page)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15_000)
                    except Exception:
                        pass
                    continue

                # --- Personal Info ---
                legal_name_section = page.locator(
                    '[data-automation-id="legalNameSection"]'
                )
                first_name_label = page.locator(
                    'label:has-text("First Name"), label:has-text("Legal First Name")'
                )
                if (
                    await legal_name_section.count() > 0
                    or await first_name_label.count() > 0
                ):
                    await _fill_personal_info(page, profile, fields_filled, fields_skipped)
                    await _click_continue(page)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15_000)
                    except Exception:
                        pass
                    continue

                # --- Work Experience ---
                experience_section = page.locator(
                    '[data-automation-id="workExperience"], '
                    'h2:has-text("Work Experience"), '
                    'legend:has-text("Work Experience")'
                )
                if await experience_section.count() > 0:
                    # Check if already populated
                    experience_entries = page.locator(
                        '[data-automation-id="workExperienceTable"] tbody tr, '
                        '[data-automation-id="experienceInstances"] > div'
                    )
                    if await experience_entries.count() > 0:
                        fields_filled.append("Work Experience (pre-populated)")
                    else:
                        # Try custom_fields or skip to AI
                        work_exp = job.custom_fields.get("work_experience")
                        if work_exp:
                            fields_filled.append("Work Experience (from custom_fields)")
                        elif self._claude_service:
                            fields_skipped.append("Work Experience (requires manual entry)")
                        else:
                            fields_skipped.append("Work Experience")
                    await _click_continue(page)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15_000)
                    except Exception:
                        pass
                    continue

                # --- EEO / Self-ID ---
                eeo_labels = page.locator(
                    'label:has-text("Gender"), label:has-text("Race"), '
                    'label:has-text("Veteran"), label:has-text("Disability")'
                )
                if await eeo_labels.count() > 0:
                    await _fill_eeo(page, job, fields_filled, fields_skipped)
                    await _click_continue(page)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15_000)
                    except Exception:
                        pass
                    continue

                # --- Unknown page: try to advance ---
                logger.info("workday unknown page, attempting to advance", step=step)
                advanced = await _click_continue(page)
                if not advanced:
                    logger.warning("no continue button found", step=step)
                    break
                try:
                    await page.wait_for_load_state("networkidle", timeout=15_000)
                except Exception:
                    pass

            # Exhausted max steps
            if page and not page.is_closed():
                screenshot_path = await screenshot_on_failure(
                    page, f"workday_stuck_{job.company}"
                )
                await page.close()

            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=resume_uploaded,
                cover_letter_uploaded=cover_letter_uploaded,
                fields_filled=fields_filled,
                fields_skipped=fields_skipped,
                error="Exhausted maximum steps without reaching submit",
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        except Exception as exc:
            logger.error(
                "workday submission failed",
                error=str(exc),
                company=job.company,
                role=job.role,
            )
            if page and not page.is_closed():
                try:
                    await screenshot_on_failure(page, f"workday_error_{job.company}")
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
                cover_letter_uploaded=cover_letter_uploaded,
                fields_filled=fields_filled,
                fields_skipped=fields_skipped,
                error=str(exc),
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )


async def _click_continue(page: object) -> bool:
    """Click Continue/Next/Save button. Returns True if a button was found and clicked."""
    from playwright.async_api import Page as _Page
    p: _Page = page  # type: ignore[assignment]
    continue_btn = p.locator(
        '[data-automation-id="bottom-navigation-next-button"], '
        'button:has-text("Continue"), '
        'button:has-text("Next"), '
        'button:has-text("Save and Continue")'
    )
    if await continue_btn.count() > 0:
        await continue_btn.first.click()
        from src.services.playwright_base import random_delay
        await random_delay(0.5, 1.0)
        return True
    return False


async def _fill_personal_info(
    page: object,
    profile: ApplicantProfile,
    fields_filled: list[str],
    fields_skipped: list[str],
) -> None:
    from playwright.async_api import Page as _Page
    p: _Page = page  # type: ignore[assignment]

    async def _try_fill(selector: str, value: str, field_name: str) -> None:
        el = p.locator(selector)
        if await el.count() > 0:
            await el.first.fill(value)
            fields_filled.append(field_name)

    async def _try_autocomplete(selector: str, value: str, field_name: str) -> None:
        """Fill an autocomplete/combobox field and select the first dropdown option."""
        import asyncio
        el = p.locator(selector)
        if await el.count() > 0:
            await el.first.fill(value)
            await asyncio.sleep(0.5)
            option = p.locator('[data-automation-id="selectOption"]')
            if await option.count() > 0:
                await option.first.click()
                fields_filled.append(field_name)
            else:
                fields_skipped.append(field_name)

    await _try_fill(
        '[data-automation-id="legalNameSection"] [data-automation-id="firstName"], '
        'input[placeholder*="First"], input[aria-label*="First Name"]',
        profile.first_name,
        "First Name",
    )
    await _try_fill(
        '[data-automation-id="legalNameSection"] [data-automation-id="lastName"], '
        'input[placeholder*="Last"], input[aria-label*="Last Name"]',
        profile.last_name,
        "Last Name",
    )
    await _try_fill(
        'input[data-automation-id="email"], input[type="email"]',
        profile.email,
        "Email",
    )
    await _try_fill(
        'input[data-automation-id="phone"], input[type="tel"]',
        profile.phone,
        "Phone",
    )
    await _try_autocomplete(
        'input[data-automation-id="addressLine1"], '
        'input[placeholder*="City"], input[aria-label*="City"]',
        profile.location,
        "Location",
    )


async def _fill_eeo(
    page: object,
    job: JobListing,
    fields_filled: list[str],
    fields_skipped: list[str],
) -> None:
    from playwright.async_api import Page as _Page
    p: _Page = page  # type: ignore[assignment]

    decline_value = "Decline_To_Self_Identify"
    eeo_fields = ["Gender", "Race", "Veteran Status", "Disability Status"]

    for field_name in eeo_fields:
        custom_val = job.custom_fields.get(field_name) or job.custom_fields.get(
            field_name.lower().replace(" ", "_")
        )
        select_el = p.locator(
            f'select[data-automation-id*="{field_name.lower().split()[0]}"], '
            f'label:has-text("{field_name}") ~ select, '
            f'label:has-text("{field_name}") + div select'
        )
        if await select_el.count() > 0:
            value = str(custom_val) if custom_val else decline_value
            try:
                await select_el.first.select_option(value=value)
                fields_filled.append(field_name)
            except Exception:
                try:
                    await select_el.first.select_option(label="Decline to self-identify")
                    fields_filled.append(f"{field_name} (declined)")
                except Exception:
                    fields_skipped.append(field_name)
        else:
            if custom_val:
                fields_skipped.append(field_name)
