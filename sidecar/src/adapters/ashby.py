from __future__ import annotations

import json
import random
import re
import time
import uuid
from pathlib import Path

import httpx
import structlog

from src.adapters.base import BaseAdapter
from src.api.models import (
    ApplicantProfile,
    FieldMappingResult,
    JobListing,
    SubmissionResult,
)
from src.utils.files import expand_path, validate_file
from src.utils.urls import hostname_matches

logger = structlog.get_logger(__name__)

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
_ASHBY_API = "https://api.ashbyhq.com"
_MAX_RETRIES = 3
_REQUEST_TIMEOUT = 30.0


def extract_posting_id(url: str) -> str:
    """Extract UUID posting ID from an Ashby URL.

    Supported patterns:
      - jobs.ashbyhq.com/{org}/{posting_id}
      - jobs.ashbyhq.com/{org}/{posting_id}/application
      - jobs.ashbyhq.com/{org}/application/{posting_id}
    """
    match = _UUID_RE.search(url)
    if match:
        return match.group(0)
    raise ValueError(f"Could not extract Ashby posting ID from URL: {url}")


class AshbyAdapter(BaseAdapter):
    def __init__(self, api_key: str | None = None) -> None:
        self._form_cache: dict[str, dict] = {}
        self._client: httpx.AsyncClient | None = None
        self._api_key = api_key

    @property
    def name(self) -> str:
        return "ashby"

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            headers: dict[str, str] = {}
            if self._api_key:
                headers["authorization"] = f"Basic {self._api_key}"
            self._client = httpx.AsyncClient(timeout=_REQUEST_TIMEOUT, headers=headers)
        return self._client

    async def _post_with_retry(self, url: str, **kwargs: object) -> httpx.Response:
        """POST with exponential backoff on 429/5xx."""
        client = await self._get_client()
        last_exc: Exception | None = None

        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = await client.post(url, **kwargs)  # type: ignore[arg-type]
                if response.status_code in (429, 500, 502, 503, 504) and attempt < _MAX_RETRIES:
                    delay = (2 ** attempt) + random.uniform(0, 0.5)
                    logger.warning(
                        "retrying request",
                        url=url,
                        status=response.status_code,
                        attempt=attempt + 1,
                        delay=delay,
                    )
                    await _async_sleep(delay)
                    continue
                return response
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    delay = (2 ** attempt) + random.uniform(0, 0.5)
                    logger.warning(
                        "retrying after network error",
                        url=url,
                        error=str(exc),
                        attempt=attempt + 1,
                        delay=delay,
                    )
                    await _async_sleep(delay)
                    continue
                raise

        raise last_exc or RuntimeError("Exhausted retries without response")

    async def _fetch_form_definition(self, posting_id: str) -> dict:
        """Fetch the application form definition for a posting. Cached."""
        if posting_id in self._form_cache:
            return self._form_cache[posting_id]

        response = await self._post_with_retry(
            f"{_ASHBY_API}/jobPosting.info",
            json={"jobPostingId": posting_id},
        )
        response.raise_for_status()
        data = response.json()

        if not data.get("success"):
            error_info = data.get("errorInfo", {})
            raise RuntimeError(
                f"Ashby API error for posting {posting_id}: "
                f"{error_info.get('message', 'unknown error')}"
            )

        form_def = data["results"]["applicationFormDefinition"]
        self._form_cache[posting_id] = form_def
        return form_def

    def _map_fields(
        self,
        form_def: dict,
        profile: ApplicantProfile,
        job: JobListing,
    ) -> FieldMappingResult:
        """Map profile/job data to Ashby form field submissions."""
        system_map: dict[str, str | None] = {
            "_systemfield_name": f"{profile.first_name} {profile.last_name}",
            "_systemfield_email": profile.email,
            "_systemfield_phone": profile.phone,
            "_systemfield_location": profile.location,
        }

        field_submissions: list[dict] = []
        file_references: dict[str, str] = {}
        unmapped_required: list[str] = []
        warnings: list[str] = []
        fields_filled: list[str] = []
        fields_skipped: list[str] = []

        for section in form_def.get("sections", []):
            for field_entry in section.get("fields", []):
                is_required = field_entry.get("isRequired", False)
                field = field_entry.get("field", {})
                path = field.get("path", "")
                field_type = field.get("type", "")
                title = field.get("title", "")

                # System fields
                if path in system_map:
                    value = system_map[path]
                    if value:
                        field_submissions.append({"path": path, "value": value})
                        fields_filled.append(title or path)
                    elif is_required:
                        unmapped_required.append(title or path)
                    else:
                        fields_skipped.append(title or path)
                    continue

                # Resume file field
                if path == "_systemfield_resume":
                    resume = job.resume_path or (profile.base_resume_path or "")
                    if resume:
                        resolved = expand_path(resume)
                        file_references["resume_1"] = resolved
                        field_submissions.append({"path": path, "value": "resume_1"})
                        fields_filled.append(title or path)
                    elif is_required:
                        unmapped_required.append(title or path)
                    else:
                        fields_skipped.append(title or path)
                    continue

                # Custom field heuristics
                title_lower = title.lower()

                # LinkedIn URL
                if "linkedin" in title_lower:
                    if profile.linkedin_url:
                        field_submissions.append({"path": path, "value": profile.linkedin_url})
                        fields_filled.append(title)
                    elif is_required:
                        unmapped_required.append(title)
                    else:
                        fields_skipped.append(title)
                    continue

                # Cover letter file
                if "cover letter" in title_lower and field_type in ("File", "file"):
                    cl_path = job.cover_letter_path
                    if cl_path:
                        resolved = expand_path(cl_path)
                        file_references["cover_letter_1"] = resolved
                        field_submissions.append({"path": path, "value": "cover_letter_1"})
                        fields_filled.append(title)
                    elif is_required:
                        unmapped_required.append(title)
                    else:
                        fields_skipped.append(title)
                    continue

                # Match from job.custom_fields by path or title
                _sentinel = object()
                matched_value = job.custom_fields.get(path, _sentinel)
                if matched_value is _sentinel:
                    matched_value = job.custom_fields.get(title, _sentinel)
                if matched_value is not _sentinel:
                    field_submissions.append({"path": path, "value": matched_value})
                    fields_filled.append(title or path)
                    continue

                # Unmatched
                if is_required:
                    unmapped_required.append(title or path)
                    warnings.append(f"Required field unmapped: {title or path} (path={path}, type={field_type})")
                else:
                    fields_skipped.append(title or path)

        return FieldMappingResult(
            field_submissions=field_submissions,
            file_references=file_references,
            unmapped_required=unmapped_required,
            warnings=warnings,
            fields_filled=fields_filled,
            fields_skipped=fields_skipped,
        )

    async def validate(self, job: JobListing) -> list[str]:
        errors: list[str] = []

        if job.ats != "ashby":
            errors.append(f"Expected ats='ashby', got '{job.ats}'")

        has_posting_id = bool(job.job_posting_id)
        has_ashby_url = hostname_matches(job.apply_url or "", "ashbyhq.com")
        if not has_posting_id and not has_ashby_url:
            errors.append("No job_posting_id and apply_url must be hosted on ashbyhq.com")

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

        try:
            # Resolve posting ID
            posting_id = job.job_posting_id
            if not posting_id:
                posting_id = extract_posting_id(job.apply_url)

            # Fetch form definition
            form_def = await self._fetch_form_definition(posting_id)

            # Map fields
            mapping = self._map_fields(form_def, profile, job)

            # Check for unmapped required fields
            if mapping.unmapped_required and not dry_run:
                return SubmissionResult(
                    job_id=job_id,
                    company=job.company,
                    role=job.role,
                    adapter=self.name,
                    status="failed",
                    resume_uploaded=False,
                    cover_letter_uploaded=False,
                    fields_filled=mapping.fields_filled,
                    fields_skipped=mapping.fields_skipped,
                    error=f"Unmapped required fields: {', '.join(mapping.unmapped_required)}",
                    duration_seconds=time.monotonic() - start,
                    timestamp=_now_iso(),
                )

            if dry_run:
                return SubmissionResult(
                    job_id=job_id,
                    company=job.company,
                    role=job.role,
                    adapter=self.name,
                    status="dry_run",
                    resume_uploaded="resume_1" in mapping.file_references,
                    cover_letter_uploaded="cover_letter_1" in mapping.file_references,
                    fields_filled=mapping.fields_filled,
                    fields_skipped=mapping.fields_skipped,
                    error=None,
                    duration_seconds=time.monotonic() - start,
                    timestamp=_now_iso(),
                )

            # Build multipart submission
            files: dict[str, tuple[str, bytes, str]] = {}
            for ref_key, file_path in mapping.file_references.items():
                p = Path(file_path)
                files[ref_key] = (p.name, p.read_bytes(), "application/pdf")

            form_data = {
                "jobPostingId": posting_id,
                "applicationForm": json.dumps({"fieldSubmissions": mapping.field_submissions}),
            }

            response = await self._post_with_retry(
                f"{_ASHBY_API}/applicationForm.submit",
                data=form_data,
                files=files,
            )
            response.raise_for_status()
            result_data = response.json()

            if not result_data.get("success"):
                error_info = result_data.get("errorInfo", {})
                return SubmissionResult(
                    job_id=job_id,
                    company=job.company,
                    role=job.role,
                    adapter=self.name,
                    status="failed",
                    resume_uploaded="resume_1" in mapping.file_references,
                    cover_letter_uploaded="cover_letter_1" in mapping.file_references,
                    fields_filled=mapping.fields_filled,
                    fields_skipped=mapping.fields_skipped,
                    error=error_info.get("message", "Submission rejected by Ashby"),
                    duration_seconds=time.monotonic() - start,
                    timestamp=_now_iso(),
                )

            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="success",
                resume_uploaded="resume_1" in mapping.file_references,
                cover_letter_uploaded="cover_letter_1" in mapping.file_references,
                fields_filled=mapping.fields_filled,
                fields_skipped=mapping.fields_skipped,
                error=None,
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        except Exception as exc:
            logger.error("ashby submission failed", error=str(exc), company=job.company, role=job.role)
            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="failed",
                resume_uploaded=False,
                cover_letter_uploaded=False,
                error=str(exc),
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _async_sleep(seconds: float) -> None:
    import asyncio
    await asyncio.sleep(seconds)
