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
)
from src.utils.files import expand_path, validate_file

logger = structlog.get_logger(__name__)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# Label substring → profile attribute or callable
_LABEL_MAP: list[tuple[str, str]] = [
    ("first name", "first_name"),
    ("given name", "first_name"),
    ("last name", "last_name"),
    ("family name", "last_name"),
    ("surname", "last_name"),
    ("email", "email"),
    ("phone", "phone"),
    ("mobile", "phone"),
    ("telephone", "phone"),
    ("linkedin", "linkedin_url"),
    ("location", "location"),
    ("city", "location"),
    ("address", "location"),
]

_BOOL_LABELS: list[tuple[str, str]] = [
    ("authorized", "authorized_to_work"),
    ("work authorization", "authorized_to_work"),
    ("sponsorship", "requires_sponsorship"),
    ("visa", "requires_sponsorship"),
]


def _profile_value_for_label(label: str, profile: ApplicantProfile) -> str | None:
    lower = label.lower()
    for keyword, attr in _LABEL_MAP:
        if keyword in lower:
            return str(getattr(profile, attr, "") or "")
    for keyword, attr in _BOOL_LABELS:
        if keyword in lower:
            val = getattr(profile, attr, None)
            if val is not None:
                return "Yes" if val else "No"
    return None


class GenericAdapter(BaseAdapter):
    def __init__(
        self,
        pw_manager: PlaywrightManager | None = None,
        claude_service: ClaudeAIService | None = None,
    ) -> None:
        self._pw_manager = pw_manager
        self._claude_service = claude_service

    @property
    def name(self) -> str:
        return "generic"

    async def validate(self, job: JobListing) -> list[str]:
        errors: list[str] = []

        if job.ats != "generic":
            errors.append(f"Expected ats='generic', got '{job.ats}'")

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
            ctx = await self._pw_manager.get_context("generic")
            page = await ctx.new_page()
            await page.goto(job.apply_url, wait_until="domcontentloaded")
            await random_delay(1.0, 2.0)

            # --- Collect all labels and their associated inputs ---
            label_elements = page.locator("label")
            label_count = await label_elements.count()

            questions_for_ai: list[dict[str, object]] = []

            for i in range(label_count):
                label_el = label_elements.nth(i)
                label_text = (await label_el.text_content() or "").strip()
                if not label_text:
                    continue

                # Find associated input: by `for` attr → matching id, or nested
                for_attr = await label_el.get_attribute("for") or ""
                if for_attr:
                    input_el = page.locator(f'#{for_attr}')
                else:
                    input_el = label_el.locator("input, select, textarea")

                if await input_el.count() == 0:
                    continue

                tag = await input_el.first.evaluate("el => el.tagName.toLowerCase()")
                input_type = await input_el.first.get_attribute("type") or "text"

                # Skip hidden / submit inputs
                if input_type in ("hidden", "submit", "button", "reset", "checkbox", "radio"):
                    continue

                # File inputs → resume / cover letter
                if input_type == "file" or tag == "input" and input_type == "file":
                    if not resume_uploaded and job.resume_path:
                        resolved = expand_path(job.resume_path)
                        try:
                            selector = f'#{for_attr}' if for_attr else "input[type='file']"
                            await page.set_input_files(selector, resolved)
                            resume_uploaded = True
                            fields_filled.append(label_text or "Resume")
                        except Exception as exc:
                            logger.warning("resume upload failed", error=str(exc))
                    elif not cover_letter_uploaded and job.cover_letter_path:
                        cl_resolved = expand_path(job.cover_letter_path)
                        try:
                            selector = f'#{for_attr}' if for_attr else "input[type='file']"
                            await page.set_input_files(selector, cl_resolved)
                            cover_letter_uploaded = True
                            fields_filled.append(label_text or "Cover Letter")
                        except Exception as exc:
                            logger.warning("cover letter upload failed", error=str(exc))
                    continue

                # Try profile match by label
                value = _profile_value_for_label(label_text, profile)

                # Try email/tel input type fallback
                if value is None:
                    if input_type == "email":
                        value = profile.email
                    elif input_type == "tel":
                        value = profile.phone

                # Try source label
                if value is None and any(
                    kw in label_text.lower()
                    for kw in ("source", "how did you hear", "how did you find")
                ):
                    value = job.source

                # Try custom_fields exact match (case-insensitive)
                if value is None:
                    for cf_key, cf_val in job.custom_fields.items():
                        if cf_key.lower() == label_text.lower():
                            value = str(cf_val)
                            break

                if value is not None:
                    try:
                        if tag == "select":
                            try:
                                await input_el.first.select_option(value=value)
                            except Exception:
                                await input_el.first.select_option(label=value)
                        else:
                            await input_el.first.fill(value)
                        fields_filled.append(label_text)
                    except Exception as exc:
                        logger.warning(
                            "could not fill field",
                            label=label_text,
                            error=str(exc),
                        )
                        fields_skipped.append(label_text)
                else:
                    # Collect for AI
                    field_entry: dict[str, object] = {
                        "label": label_text,
                        "type": "select" if tag == "select" else "text",
                        "required": True,
                    }
                    if tag == "select":
                        option_els = input_el.first.locator("option")
                        opts = []
                        for j in range(await option_els.count()):
                            opt_text = await option_els.nth(j).text_content()
                            if opt_text and opt_text.strip():
                                opts.append(opt_text.strip())
                        field_entry["options"] = opts
                    questions_for_ai.append(field_entry)

            # --- Handle standalone inputs without labels ---
            unlinked_files = page.locator(
                "input[type='file']:not([id]), input[type='file'][id='']"
            )
            unlinked_count = await unlinked_files.count()
            if unlinked_count > 0 and not resume_uploaded and job.resume_path:
                resolved = expand_path(job.resume_path)
                try:
                    await unlinked_files.first.set_input_files(resolved)
                    resume_uploaded = True
                    fields_filled.append("Resume (unlabeled)")
                except Exception as exc:
                    logger.warning("unlabeled resume upload failed", error=str(exc))

            # --- AI fallback for unmapped fields ---
            if questions_for_ai and self._claude_service:
                try:
                    mapped = await self._claude_service.map_fields(
                        questions_for_ai, profile, job
                    )
                    for q in questions_for_ai:
                        q_label = str(q["label"])
                        if q_label in mapped:
                            answer = mapped[q_label]
                            # Re-find input to fill
                            target_label = page.locator(
                                f"label:has-text('{q_label}')"
                            )
                            if await target_label.count() > 0:
                                for_attr = (
                                    await target_label.first.get_attribute("for") or ""
                                )
                                if for_attr:
                                    inp = page.locator(f"#{for_attr}")
                                else:
                                    inp = target_label.first.locator(
                                        "input, select, textarea"
                                    )
                                if await inp.count() > 0:
                                    tag = await inp.first.evaluate(
                                        "el => el.tagName.toLowerCase()"
                                    )
                                    try:
                                        if tag == "select":
                                            try:
                                                await inp.first.select_option(value=answer)
                                            except Exception:
                                                await inp.first.select_option(label=answer)
                                        else:
                                            await inp.first.fill(answer)
                                        fields_filled.append(q_label)
                                    except Exception as exc:
                                        logger.warning(
                                            "AI fill failed",
                                            label=q_label,
                                            error=str(exc),
                                        )
                                        fields_skipped.append(q_label)
                                else:
                                    fields_skipped.append(q_label)
                            else:
                                fields_skipped.append(q_label)
                        else:
                            fields_skipped.append(q_label)
                except Exception as exc:
                    logger.warning("claude AI mapping failed", error=str(exc))
                    for q in questions_for_ai:
                        fields_skipped.append(str(q["label"]))
            else:
                for q in questions_for_ai:
                    fields_skipped.append(str(q["label"]))

            # --- Find and click submit ---
            submit_btn = page.locator(
                'button[type="submit"], '
                'input[type="submit"], '
                'button:has-text("Submit"), '
                'button:has-text("Apply")'
            )

            if dry_run:
                screenshot_path = await screenshot_on_failure(
                    page, f"generic_dry_run_{job.company}"
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

            if await submit_btn.count() > 0:
                logger.warning(
                    "auto-submitting generic application",
                    company=job.company,
                    role=job.role,
                )
                await submit_btn.first.click()
                await random_delay(2.0, 3.0)
                try:
                    await page.wait_for_load_state("networkidle", timeout=15_000)
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
            else:
                if page and not page.is_closed():
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
                    error="No submit button found on page",
                    duration_seconds=time.monotonic() - start,
                    timestamp=_now_iso(),
                )

        except Exception as exc:
            logger.error(
                "generic submission failed",
                error=str(exc),
                company=job.company,
                role=job.role,
            )
            if page and not page.is_closed():
                try:
                    await screenshot_on_failure(page, f"generic_error_{job.company}")
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
