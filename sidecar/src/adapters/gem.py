from __future__ import annotations

import time
import uuid

import structlog

from src.adapters.base import BaseAdapter
from src.api.models import ApplicantProfile, JobListing, SubmissionResult
from src.services.claude_ai import ClaudeAIService
from src.services.playwright_base import (
    PlaywrightManager,
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


# Maps label substrings (lowercase) to profile fields
_LABEL_MAP: list[tuple[str, str]] = [
    ("first name", "first_name"),
    ("last name", "last_name"),
    ("email", "email"),
    ("phone", "phone"),
    ("linkedin", "linkedin_url"),
    ("location", "location"),
]

# Labels that map to yes/no fields derived from profile booleans
_AUTH_LABELS = ("authorized", "work authorization")
_SPONSOR_LABELS = ("sponsorship", "visa")
_SOURCE_LABELS = ("how did you hear", "source")


class GemAdapter(BaseAdapter):
    def __init__(
        self,
        pw_manager: PlaywrightManager | None = None,
        claude_service: ClaudeAIService | None = None,
    ) -> None:
        self._pw_manager = pw_manager
        self._claude_service = claude_service

    @property
    def name(self) -> str:
        return "gem"

    async def validate(self, job: JobListing) -> list[str]:
        errors: list[str] = []

        if job.ats != "gem":
            errors.append(f"Expected ats='gem', got '{job.ats}'")

        if not job.apply_url:
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
            ctx = await self._pw_manager.get_context("gem")
            page = await ctx.new_page()
            await page.goto(job.apply_url, wait_until="domcontentloaded")
            await random_delay(1.0, 2.0)

            # Collect all form fields with their labels
            # Gem forms use standard label/input pairs
            form_fields = page.locator("div.field, div.form-group, div[class*='FormField'], div[class*='form-field']")
            field_count = await form_fields.count()

            # Build a flat list of (label_text_lower, element) pairs for matching
            handled_labels: set[str] = set()
            questions_for_ai: list[dict[str, object]] = []

            for i in range(field_count):
                field_div = form_fields.nth(i)

                # Extract label text
                label_el = field_div.locator("label")
                label_text = await label_el.first.text_content() if await label_el.count() > 0 else ""
                label_text = (label_text or "").strip()
                label_lower = label_text.lower()

                if not label_text or label_lower in handled_labels:
                    continue

                handled_labels.add(label_lower)

                # File upload fields
                file_input = field_div.locator('input[type="file"]')
                if await file_input.count() > 0:
                    if any(kw in label_lower for kw in ("resume", "cv")):
                        resume_path = job.resume_path or (profile.base_resume_path or "")
                        if resume_path:
                            resolved = expand_path(resume_path)
                            await upload_file(page, 'input[type="file"]', resolved)
                            resume_uploaded = True
                            fields_filled.append(label_text)
                    elif "cover letter" in label_lower and job.cover_letter_path:
                        resolved = expand_path(job.cover_letter_path)
                        await upload_file(page, 'input[type="file"]', resolved)
                        cover_letter_uploaded = True
                        fields_filled.append(label_text)
                    continue

                # Determine standard profile value by label heuristic
                profile_value: str | None = None

                for substring, attr in _LABEL_MAP:
                    if substring in label_lower:
                        profile_value = str(getattr(profile, attr, "") or "")
                        break

                if profile_value is None:
                    if any(kw in label_lower for kw in _AUTH_LABELS):
                        profile_value = "Yes" if profile.authorized_to_work else "No"
                    elif any(kw in label_lower for kw in _SPONSOR_LABELS):
                        profile_value = "Yes" if profile.requires_sponsorship else "No"
                    elif any(kw in label_lower for kw in _SOURCE_LABELS):
                        profile_value = job.source

                # Custom fields override heuristics
                if label_text in job.custom_fields:
                    profile_value = str(job.custom_fields[label_text])

                if profile_value is not None:
                    select_el = field_div.locator("select")
                    if await select_el.count() > 0:
                        try:
                            await select_option(page, "select", profile_value)
                            fields_filled.append(label_text)
                        except Exception:
                            fields_skipped.append(label_text)
                    else:
                        text_input = field_div.locator("input:not([type='file']):not([type='checkbox']):not([type='radio']), textarea")
                        if await text_input.count() > 0:
                            await text_input.first.fill(profile_value)
                            fields_filled.append(label_text)
                        else:
                            fields_skipped.append(label_text)
                    continue

                # Remaining fields — collect for AI
                field_type = "text"
                select_el = field_div.locator("select")
                if await select_el.count() > 0:
                    field_type = "select"
                    options: list[str] = []
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
                    text_input = field_div.locator("input:not([type='file']):not([type='checkbox']):not([type='radio']), textarea")
                    if await text_input.count() > 0:
                        questions_for_ai.append({
                            "label": label_text,
                            "type": field_type,
                            "required": True,
                        })

            # Use Claude AI for remaining unmapped fields
            if questions_for_ai and self._claude_service:
                mapped = await self._claude_service.map_fields(questions_for_ai, profile, job)
                for q in questions_for_ai:
                    q_label = str(q["label"])
                    if q_label in mapped:
                        answer = mapped[q_label]
                        # Refind and fill
                        for i in range(field_count):
                            field_div = form_fields.nth(i)
                            label_el = field_div.locator("label")
                            text = await label_el.first.text_content() if await label_el.count() > 0 else ""
                            if (text or "").strip() == q_label:
                                if q.get("type") == "select":
                                    sel = field_div.locator("select")
                                    if await sel.count() > 0:
                                        await select_option(page, "select", answer)
                                else:
                                    inp = field_div.locator("input:not([type='file']):not([type='checkbox']):not([type='radio']), textarea")
                                    if await inp.count() > 0:
                                        await inp.first.fill(answer)
                                fields_filled.append(q_label)
                                break
                    else:
                        fields_skipped.append(q_label)
            elif questions_for_ai:
                for q in questions_for_ai:
                    fields_skipped.append(str(q["label"]))

            # Find submit button
            submit_btn = page.locator(
                'button[type="submit"], button:has-text("Submit"), button:has-text("Apply")'
            )

            if dry_run:
                screenshot_path = await screenshot_on_failure(page, f"gem_dry_run_{job.company}")
                logger.info("dry run complete, screenshot saved", path=screenshot_path)
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

            if await submit_btn.count() == 0:
                raise RuntimeError("Could not find submit button on Gem application page")

            logger.warning("auto-submitting Gem application", company=job.company, role=job.role)
            await submit_btn.first.click()
            await random_delay(2.0, 3.0)

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

        except Exception as exc:
            logger.error("gem submission failed", error=str(exc), company=job.company, role=job.role)
            if page and not page.is_closed():
                try:
                    await screenshot_on_failure(page, f"gem_error_{job.company}")
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
