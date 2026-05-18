from __future__ import annotations

import random
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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

_GH_BOARDS_API = "https://boards-api.greenhouse.io/v1/boards"
_MAX_RETRIES = 3
_REQUEST_TIMEOUT = 30.0

_GREENHOUSE_ROOT = "greenhouse.io"
_GREENHOUSE_BOARDS_HOSTS = {"boards.greenhouse.io", "job-boards.greenhouse.io"}


def extract_board_and_job(url: str) -> tuple[str, str]:
    """Extract (board_token, job_id) from a Greenhouse URL.

    Supported patterns:
      - boards.greenhouse.io/{board_token}/jobs/{job_id}
      - job-boards.greenhouse.io/{board_token}/jobs/{job_id}
      - {company}.greenhouse.io/jobs/{job_id}  (company = board_token)
      - ?gh_jid={job_id}  (query param; board_token taken from host or path)
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    path_parts = [part for part in parsed.path.split("/") if part]
    qs = parse_qs(parsed.query)

    if "gh_jid" in qs:
        job_id = qs["gh_jid"][0]
        if not job_id.isdigit():
            raise ValueError(f"Could not extract Greenhouse job_id from URL: {url}")
        if host in _GREENHOUSE_BOARDS_HOSTS and path_parts:
            return path_parts[0], job_id
        if hostname_matches(url, _GREENHOUSE_ROOT) and host not in _GREENHOUSE_BOARDS_HOSTS:
            return host.removesuffix(f".{_GREENHOUSE_ROOT}"), job_id
        raise ValueError(f"Could not extract board_token from Greenhouse URL with gh_jid: {url}")

    if host in _GREENHOUSE_BOARDS_HOSTS and len(path_parts) >= 3 and path_parts[1] == "jobs":
        job_id = path_parts[2]
        if job_id.isdigit():
            return path_parts[0], job_id

    if (
        hostname_matches(url, _GREENHOUSE_ROOT)
        and host not in _GREENHOUSE_BOARDS_HOSTS
        and len(path_parts) >= 2
        and path_parts[0] == "jobs"
        and path_parts[1].isdigit()
    ):
        return host.removesuffix(f".{_GREENHOUSE_ROOT}"), path_parts[1]

    raise ValueError(f"Could not extract board_token and job_id from Greenhouse URL: {url}")


class GreenhouseAdapter(BaseAdapter):
    def __init__(self) -> None:
        self._question_cache: dict[str, dict] = {}
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "greenhouse"

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=_REQUEST_TIMEOUT)
        return self._client

    async def _request_with_retry(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        """GET or POST with exponential backoff on 429/5xx."""
        client = await self._get_client()
        last_exc: Exception | None = None

        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = await client.request(method, url, **kwargs)  # type: ignore[arg-type]
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

    async def _fetch_job_questions(self, board_token: str, job_id: str) -> dict:
        """Fetch job questions from the Greenhouse boards API. Cached."""
        cache_key = f"{board_token}:{job_id}"
        if cache_key in self._question_cache:
            return self._question_cache[cache_key]

        url = f"{_GH_BOARDS_API}/{board_token}/jobs/{job_id}?questions=true"
        response = await self._request_with_retry("GET", url)
        response.raise_for_status()
        data = response.json()

        self._question_cache[cache_key] = data
        return data

    def _map_fields(
        self,
        questions: list[dict],
        profile: ApplicantProfile,
        job: JobListing,
    ) -> FieldMappingResult:
        """Map profile/job data to Greenhouse question field submissions."""
        field_submissions: list[dict] = []
        file_references: dict[str, str] = {}
        unmapped_required: list[str] = []
        warnings: list[str] = []
        fields_filled: list[str] = []
        fields_skipped: list[str] = []

        for question in questions:
            is_required = question.get("required", False)
            label = question.get("label", "")
            label_lower = label.lower()
            fields = question.get("fields", [])

            if not fields:
                continue

            # Use the first field entry for name/type
            field_def = fields[0]
            field_name = field_def.get("name", "")
            field_type = field_def.get("type", "")

            # Standard field mapping by field name
            if field_name == "first_name":
                field_submissions.append({"name": field_name, "value": profile.first_name})
                fields_filled.append(label or field_name)
                continue

            if field_name == "last_name":
                field_submissions.append({"name": field_name, "value": profile.last_name})
                fields_filled.append(label or field_name)
                continue

            if field_name == "email":
                field_submissions.append({"name": field_name, "value": profile.email})
                fields_filled.append(label or field_name)
                continue

            if field_name == "phone":
                field_submissions.append({"name": field_name, "value": profile.phone})
                fields_filled.append(label or field_name)
                continue

            if field_name == "location":
                field_submissions.append({"name": field_name, "value": profile.location})
                fields_filled.append(label or field_name)
                continue

            # Resume file field
            if field_name == "resume" and field_type == "input_file":
                resume = job.resume_path or (profile.base_resume_path or "")
                if resume:
                    resolved = expand_path(resume)
                    file_references["resume"] = resolved
                    fields_filled.append(label or field_name)
                elif is_required:
                    unmapped_required.append(label or field_name)
                    warnings.append(f"Required field unmapped: {label or field_name} (name={field_name}, type={field_type})")
                else:
                    fields_skipped.append(label or field_name)
                continue

            # Cover letter file field
            if field_name == "cover_letter" and field_type == "input_file":
                cl_path = job.cover_letter_path
                if cl_path:
                    resolved = expand_path(cl_path)
                    file_references["cover_letter"] = resolved
                    fields_filled.append(label or field_name)
                elif is_required:
                    unmapped_required.append(label or field_name)
                    warnings.append(f"Required field unmapped: {label or field_name} (name={field_name}, type={field_type})")
                else:
                    fields_skipped.append(label or field_name)
                continue

            # Heuristic mapping by label
            if "linkedin" in label_lower:
                if profile.linkedin_url:
                    field_submissions.append({"name": field_name, "value": profile.linkedin_url})
                    fields_filled.append(label or field_name)
                elif is_required:
                    unmapped_required.append(label or field_name)
                    warnings.append(f"Required field unmapped: {label or field_name} (name={field_name})")
                else:
                    fields_skipped.append(label or field_name)
                continue

            if "authorized" in label_lower or "work authorization" in label_lower:
                value = "Yes" if profile.authorized_to_work else "No"
                field_submissions.append({"name": field_name, "value": value})
                fields_filled.append(label or field_name)
                continue

            if "sponsorship" in label_lower or "visa" in label_lower:
                value = "Yes" if profile.requires_sponsorship else "No"
                field_submissions.append({"name": field_name, "value": value})
                fields_filled.append(label or field_name)
                continue

            # Match from job.custom_fields by field name or label
            _sentinel = object()
            matched_value = job.custom_fields.get(field_name, _sentinel)
            if matched_value is _sentinel:
                matched_value = job.custom_fields.get(label, _sentinel)
            if matched_value is not _sentinel:
                field_submissions.append({"name": field_name, "value": matched_value})
                fields_filled.append(label or field_name)
                continue

            # Unmatched
            if is_required:
                unmapped_required.append(label or field_name)
                warnings.append(f"Required field unmapped: {label or field_name} (name={field_name}, type={field_type})")
            else:
                fields_skipped.append(label or field_name)

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

        if job.ats != "greenhouse":
            errors.append(f"Expected ats='greenhouse', got '{job.ats}'")

        has_board_and_id = bool(job.board_token and job.job_posting_id)
        has_greenhouse_url = hostname_matches(job.apply_url or "", _GREENHOUSE_ROOT)
        if not has_board_and_id and not has_greenhouse_url:
            errors.append(
                "No board_token+job_posting_id and apply_url must be hosted on greenhouse.io"
            )

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
            # Resolve board_token and posting_id
            board_token = job.board_token
            posting_id = job.job_posting_id
            if not board_token or not posting_id:
                board_token, posting_id = extract_board_and_job(job.apply_url)

            # Fetch questions (cached)
            job_data = await self._fetch_job_questions(board_token, posting_id)
            questions: list[dict] = job_data.get("questions", [])

            # Map fields
            mapping = self._map_fields(questions, profile, job)

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
                    resume_uploaded="resume" in mapping.file_references,
                    cover_letter_uploaded="cover_letter" in mapping.file_references,
                    fields_filled=mapping.fields_filled,
                    fields_skipped=mapping.fields_skipped,
                    error=None,
                    duration_seconds=time.monotonic() - start,
                    timestamp=_now_iso(),
                )

            # Build multipart submission
            # Greenhouse boards API POST: multipart/form-data
            data: dict[str, str] = {}
            for submission in mapping.field_submissions:
                data[submission["name"]] = str(submission["value"])

            files: dict[str, tuple[str, bytes, str]] = {}
            if "resume" in mapping.file_references:
                p = Path(mapping.file_references["resume"])
                files["resume"] = (p.name, p.read_bytes(), "application/pdf")
            if "cover_letter" in mapping.file_references:
                p = Path(mapping.file_references["cover_letter"])
                files["cover_letter"] = (p.name, p.read_bytes(), "application/pdf")

            url = f"{_GH_BOARDS_API}/{board_token}/jobs/{posting_id}"
            response = await self._request_with_retry("POST", url, data=data, files=files)

            if response.status_code in (401, 403):
                return SubmissionResult(
                    job_id=job_id,
                    company=job.company,
                    role=job.role,
                    adapter=self.name,
                    status="manual_required",
                    resume_uploaded="resume" in mapping.file_references,
                    cover_letter_uploaded="cover_letter" in mapping.file_references,
                    fields_filled=mapping.fields_filled,
                    fields_skipped=mapping.fields_skipped,
                    error=f"Authorization required (HTTP {response.status_code})",
                    duration_seconds=time.monotonic() - start,
                    timestamp=_now_iso(),
                )

            response.raise_for_status()

            return SubmissionResult(
                job_id=job_id,
                company=job.company,
                role=job.role,
                adapter=self.name,
                status="success",
                resume_uploaded="resume" in mapping.file_references,
                cover_letter_uploaded="cover_letter" in mapping.file_references,
                fields_filled=mapping.fields_filled,
                fields_skipped=mapping.fields_skipped,
                error=None,
                duration_seconds=time.monotonic() - start,
                timestamp=_now_iso(),
            )

        except Exception as exc:
            logger.error(
                "greenhouse submission failed",
                error=str(exc),
                company=job.company,
                role=job.role,
            )
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
