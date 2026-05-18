from __future__ import annotations

import os

import pytest

from src.adapters.ashby import AshbyAdapter, extract_posting_id
from src.api.models import ApplicantProfile, JobListing


# --- Fixtures ---

@pytest.fixture
def profile() -> ApplicantProfile:
    return ApplicantProfile(
        first_name="Jane",
        last_name="Doe",
        email="jane@example.com",
        phone="+15551234567",
        linkedin_url="https://linkedin.com/in/janedoe",
        location="San Francisco, CA",
        authorized_to_work=True,
        requires_sponsorship=False,
        base_resume_path="/tmp/test_resume.pdf",
    )


@pytest.fixture
def job() -> JobListing:
    return JobListing(
        company="TestCo",
        role="Software Engineer",
        ats="ashby",
        apply_url="https://jobs.ashbyhq.com/testco/9a60f41c-1df7-4330-bd0c-ba1481a13bbb",
        resume_path="/tmp/test_resume.pdf",
    )


@pytest.fixture
def adapter() -> AshbyAdapter:
    return AshbyAdapter()


def _make_form_def(fields: list[dict]) -> dict:
    """Helper to build a minimal form definition."""
    return {"sections": [{"fields": fields}]}


def _field(path: str, title: str, field_type: str = "String", required: bool = True) -> dict:
    return {
        "isRequired": required,
        "field": {"path": path, "type": field_type, "title": title, "selectableValues": []},
    }


# --- extract_posting_id ---

class TestExtractPostingId:
    def test_standard_url(self) -> None:
        url = "https://jobs.ashbyhq.com/ramp/9a60f41c-1df7-4330-bd0c-ba1481a13bbb"
        assert extract_posting_id(url) == "9a60f41c-1df7-4330-bd0c-ba1481a13bbb"

    def test_url_with_application_suffix(self) -> None:
        url = "https://jobs.ashbyhq.com/ramp/9a60f41c-1df7-4330-bd0c-ba1481a13bbb/application"
        assert extract_posting_id(url) == "9a60f41c-1df7-4330-bd0c-ba1481a13bbb"

    def test_url_with_application_prefix(self) -> None:
        url = "https://jobs.ashbyhq.com/ramp/application/9a60f41c-1df7-4330-bd0c-ba1481a13bbb"
        assert extract_posting_id(url) == "9a60f41c-1df7-4330-bd0c-ba1481a13bbb"

    def test_invalid_url_raises(self) -> None:
        with pytest.raises(ValueError, match="Could not extract"):
            extract_posting_id("https://jobs.ashbyhq.com/ramp/not-a-uuid")

    def test_non_ashby_url_with_uuid(self) -> None:
        url = "https://example.com/jobs/9a60f41c-1df7-4330-bd0c-ba1481a13bbb"
        assert extract_posting_id(url) == "9a60f41c-1df7-4330-bd0c-ba1481a13bbb"


# --- _map_fields ---

class TestMapFields:
    def test_system_fields(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        form_def = _make_form_def([
            _field("_systemfield_name", "Full Name"),
            _field("_systemfield_email", "Email"),
            _field("_systemfield_phone", "Phone"),
            _field("_systemfield_location", "Location"),
        ])
        result = adapter._map_fields(form_def, profile, job)

        assert len(result.field_submissions) == 4
        submissions = {s["path"]: s["value"] for s in result.field_submissions}
        assert submissions["_systemfield_name"] == "Jane Doe"
        assert submissions["_systemfield_email"] == "jane@example.com"
        assert submissions["_systemfield_phone"] == "+15551234567"
        assert submissions["_systemfield_location"] == "San Francisco, CA"
        assert result.unmapped_required == []
        assert len(result.fields_filled) == 4

    def test_resume_field(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        form_def = _make_form_def([
            _field("_systemfield_resume", "Resume", "File"),
        ])
        result = adapter._map_fields(form_def, profile, job)

        assert "resume_1" in result.file_references
        assert result.file_references["resume_1"] == "/tmp/test_resume.pdf"
        submissions = {s["path"]: s["value"] for s in result.field_submissions}
        assert submissions["_systemfield_resume"] == "resume_1"

    def test_linkedin_heuristic(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        form_def = _make_form_def([
            _field("custom_linkedin_profile", "LinkedIn Profile URL"),
        ])
        result = adapter._map_fields(form_def, profile, job)

        submissions = {s["path"]: s["value"] for s in result.field_submissions}
        assert submissions["custom_linkedin_profile"] == "https://linkedin.com/in/janedoe"
        assert "LinkedIn Profile URL" in result.fields_filled

    def test_cover_letter_file(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        job_with_cl = job.model_copy(update={"cover_letter_path": "/tmp/cover_letter.pdf"})
        form_def = _make_form_def([
            _field("custom_cover_letter", "Cover Letter", "File"),
        ])
        result = adapter._map_fields(form_def, profile, job_with_cl)

        assert "cover_letter_1" in result.file_references
        submissions = {s["path"]: s["value"] for s in result.field_submissions}
        assert submissions["custom_cover_letter"] == "cover_letter_1"

    def test_custom_fields_by_path(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        job_custom = job.model_copy(update={"custom_fields": {"custom_salary": "150000"}})
        form_def = _make_form_def([
            _field("custom_salary", "Expected Salary"),
        ])
        result = adapter._map_fields(form_def, profile, job_custom)

        submissions = {s["path"]: s["value"] for s in result.field_submissions}
        assert submissions["custom_salary"] == "150000"

    def test_custom_fields_by_title(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        job_custom = job.model_copy(update={"custom_fields": {"Expected Salary": "150000"}})
        form_def = _make_form_def([
            _field("custom_salary", "Expected Salary"),
        ])
        result = adapter._map_fields(form_def, profile, job_custom)

        submissions = {s["path"]: s["value"] for s in result.field_submissions}
        assert submissions["custom_salary"] == "150000"

    def test_unmapped_required_field(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        form_def = _make_form_def([
            _field("custom_visa_status", "Visa Status", required=True),
        ])
        result = adapter._map_fields(form_def, profile, job)

        assert "Visa Status" in result.unmapped_required
        assert len(result.warnings) == 1
        assert "Visa Status" in result.warnings[0]

    def test_optional_field_skipped(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        form_def = _make_form_def([
            _field("custom_website", "Personal Website", required=False),
        ])
        result = adapter._map_fields(form_def, profile, job)

        assert result.unmapped_required == []
        assert "Personal Website" in result.fields_skipped

    def test_resume_fallback_to_profile(self, adapter: AshbyAdapter, profile: ApplicantProfile, job: JobListing) -> None:
        job_no_resume = job.model_copy(update={"resume_path": ""})
        form_def = _make_form_def([
            _field("_systemfield_resume", "Resume", "File"),
        ])
        result = adapter._map_fields(form_def, profile, job_no_resume)

        assert "resume_1" in result.file_references
        assert result.file_references["resume_1"] == "/tmp/test_resume.pdf"


# --- validate ---

class TestValidate:
    @pytest.mark.asyncio
    async def test_valid_job(self, adapter: AshbyAdapter, job: JobListing) -> None:
        # Create a dummy PDF for validation
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4 test content")
            tmp_path = f.name

        valid_job = job.model_copy(update={"resume_path": tmp_path})
        errors = await adapter.validate(valid_job)
        assert errors == []

        import os
        os.unlink(tmp_path)

    @pytest.mark.asyncio
    async def test_wrong_ats(self, adapter: AshbyAdapter, job: JobListing) -> None:
        bad_job = job.model_copy(update={"ats": "greenhouse"})
        errors = await adapter.validate(bad_job)
        assert any("ats='ashby'" in e for e in errors)

    @pytest.mark.asyncio
    async def test_no_posting_or_url(self, adapter: AshbyAdapter, job: JobListing) -> None:
        bad_job = job.model_copy(update={"apply_url": "https://example.com/jobs", "job_posting_id": None})
        errors = await adapter.validate(bad_job)
        assert "No job_posting_id and apply_url must be hosted on ashbyhq.com" in errors

    async def test_rejects_lookalike_ashby_host(self, adapter: AshbyAdapter, job: JobListing) -> None:
        bad_job = job.model_copy(
            update={
                "apply_url": "https://evilashbyhq.com/testco/9a60f41c-1df7-4330-bd0c-ba1481a13bbb",
                "job_posting_id": None,
            }
        )
        errors = await adapter.validate(bad_job)
        assert "No job_posting_id and apply_url must be hosted on ashbyhq.com" in errors


# --- Integration tests (require network) ---

_ASHBY_API_KEY = os.environ.get("ASHBY_API_KEY")
_skip_no_key = pytest.mark.skipif(not _ASHBY_API_KEY, reason="ASHBY_API_KEY not set")


@pytest.fixture
def authed_adapter() -> AshbyAdapter:
    return AshbyAdapter(api_key=_ASHBY_API_KEY)


@pytest.mark.integration
class TestIntegration:
    @_skip_no_key
    @pytest.mark.asyncio
    async def test_fetch_form_definition_ramp(self, authed_adapter: AshbyAdapter) -> None:
        form_def = await authed_adapter._fetch_form_definition("9a60f41c-1df7-4330-bd0c-ba1481a13bbb")
        assert "sections" in form_def
        assert len(form_def["sections"]) > 0

    @_skip_no_key
    @pytest.mark.asyncio
    async def test_fetch_form_definition_whatnot(self, authed_adapter: AshbyAdapter) -> None:
        form_def = await authed_adapter._fetch_form_definition("3d7eb1de-fc4b-44e6-ad18-a49c0dfc9aeb")
        assert "sections" in form_def

    @_skip_no_key
    @pytest.mark.asyncio
    async def test_dry_run_submission(self, authed_adapter: AshbyAdapter, profile: ApplicantProfile) -> None:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4 test content")
            tmp_path = f.name

        job = JobListing(
            company="Ramp",
            role="Software Engineer",
            ats="ashby",
            apply_url="https://jobs.ashbyhq.com/ramp/9a60f41c-1df7-4330-bd0c-ba1481a13bbb",
            resume_path=tmp_path,
        )
        result = await authed_adapter.submit(job, profile, dry_run=True)
        assert result.status == "dry_run"
        assert result.adapter == "ashby"
        assert len(result.fields_filled) > 0

        os.unlink(tmp_path)
