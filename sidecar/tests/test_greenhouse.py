from __future__ import annotations

import os

import pytest

from src.adapters.greenhouse import GreenhouseAdapter, extract_board_and_job
from src.api.models import ApplicantProfile, JobListing


# --- Helpers ---

def _question(
    label: str,
    field_name: str,
    field_type: str = "input_text",
    required: bool = True,
    values: list | None = None,
) -> dict:
    return {
        "required": required,
        "label": label,
        "fields": [{"name": field_name, "type": field_type, "values": values or []}],
    }


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
        ats="greenhouse",
        apply_url="https://boards.greenhouse.io/testco/jobs/4567890",
        resume_path="/tmp/test_resume.pdf",
    )


@pytest.fixture
def adapter() -> GreenhouseAdapter:
    return GreenhouseAdapter()


# --- TestExtractBoardAndJob ---

class TestExtractBoardAndJob:
    def test_boards_url(self) -> None:
        url = "https://boards.greenhouse.io/acmecorp/jobs/1234567"
        board, job_id = extract_board_and_job(url)
        assert board == "acmecorp"
        assert job_id == "1234567"

    def test_job_boards_url(self) -> None:
        url = "https://job-boards.greenhouse.io/acmecorp/jobs/7654321"
        board, job_id = extract_board_and_job(url)
        assert board == "acmecorp"
        assert job_id == "7654321"

    def test_company_subdomain_url(self) -> None:
        url = "https://acmecorp.greenhouse.io/jobs/9999999"
        board, job_id = extract_board_and_job(url)
        assert board == "acmecorp"
        assert job_id == "9999999"

    def test_gh_jid_query_param(self) -> None:
        url = "https://acmecorp.greenhouse.io/careers?gh_jid=5555555"
        board, job_id = extract_board_and_job(url)
        assert board == "acmecorp"
        assert job_id == "5555555"

    def test_invalid_url_raises(self) -> None:
        with pytest.raises(ValueError, match="Could not extract"):
            extract_board_and_job("https://example.com/jobs/notgreenhouse")


# --- TestMapFields ---

class TestMapFields:
    def test_standard_fields(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        questions = [
            _question("First Name", "first_name"),
            _question("Last Name", "last_name"),
            _question("Email", "email"),
            _question("Phone", "phone"),
        ]
        result = adapter._map_fields(questions, profile, job)

        assert result.unmapped_required == []
        submissions = {s["name"]: s["value"] for s in result.field_submissions}
        assert submissions["first_name"] == "Jane"
        assert submissions["last_name"] == "Doe"
        assert submissions["email"] == "jane@example.com"
        assert submissions["phone"] == "+15551234567"
        assert len(result.fields_filled) == 4

    def test_resume_file_field(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        questions = [_question("Resume", "resume", field_type="input_file")]
        result = adapter._map_fields(questions, profile, job)

        assert "resume" in result.file_references
        assert result.file_references["resume"] == "/tmp/test_resume.pdf"
        assert "Resume" in result.fields_filled

    def test_linkedin_heuristic(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        questions = [_question("LinkedIn Profile", "linkedin_url")]
        result = adapter._map_fields(questions, profile, job)

        submissions = {s["name"]: s["value"] for s in result.field_submissions}
        assert submissions["linkedin_url"] == "https://linkedin.com/in/janedoe"
        assert "LinkedIn Profile" in result.fields_filled

    def test_work_authorization(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        questions = [_question("Are you authorized to work?", "work_auth")]
        result = adapter._map_fields(questions, profile, job)

        submissions = {s["name"]: s["value"] for s in result.field_submissions}
        assert submissions["work_auth"] == "Yes"
        assert "Are you authorized to work?" in result.fields_filled

    def test_sponsorship(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        questions = [_question("Do you require sponsorship?", "sponsorship_needed")]
        result = adapter._map_fields(questions, profile, job)

        submissions = {s["name"]: s["value"] for s in result.field_submissions}
        # profile.requires_sponsorship = False
        assert submissions["sponsorship_needed"] == "No"
        assert "Do you require sponsorship?" in result.fields_filled

    def test_unmapped_required(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        questions = [_question("Desired Salary", "desired_salary", required=True)]
        result = adapter._map_fields(questions, profile, job)

        assert "Desired Salary" in result.unmapped_required
        assert len(result.warnings) >= 1
        assert "Desired Salary" in result.warnings[0]

    def test_custom_fields_by_name(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        job_custom = job.model_copy(update={"custom_fields": {"desired_salary": "180000"}})
        questions = [_question("Desired Salary", "desired_salary")]
        result = adapter._map_fields(questions, profile, job_custom)

        submissions = {s["name"]: s["value"] for s in result.field_submissions}
        assert submissions["desired_salary"] == "180000"
        assert "Desired Salary" in result.fields_filled

    def test_custom_fields_by_label(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile, job: JobListing
    ) -> None:
        job_custom = job.model_copy(update={"custom_fields": {"Desired Salary": "180000"}})
        questions = [_question("Desired Salary", "desired_salary")]
        result = adapter._map_fields(questions, profile, job_custom)

        submissions = {s["name"]: s["value"] for s in result.field_submissions}
        assert submissions["desired_salary"] == "180000"
        assert "Desired Salary" in result.fields_filled


# --- TestValidate ---

class TestValidate:
    @pytest.mark.asyncio
    async def test_wrong_ats(self, adapter: GreenhouseAdapter, job: JobListing) -> None:
        bad_job = job.model_copy(update={"ats": "ashby"})
        errors = await adapter.validate(bad_job)
        assert any("ats='greenhouse'" in e for e in errors)

    @pytest.mark.asyncio
    async def test_no_board_or_url(self, adapter: GreenhouseAdapter, job: JobListing) -> None:
        bad_job = job.model_copy(
            update={"apply_url": "https://example.com/careers", "board_token": None, "job_posting_id": None}
        )
        errors = await adapter.validate(bad_job)
        assert any("greenhouse.io" in e for e in errors)

    @pytest.mark.asyncio
    async def test_missing_resume(self, adapter: GreenhouseAdapter, job: JobListing) -> None:
        bad_job = job.model_copy(update={"resume_path": ""})
        errors = await adapter.validate(bad_job)
        assert any("resume" in e.lower() for e in errors)


# --- Integration tests (require network) ---

@pytest.mark.integration
class TestIntegration:
    @pytest.mark.asyncio
    async def test_fetch_questions(self, adapter: GreenhouseAdapter) -> None:
        # Embed is a well-known public Greenhouse board
        # Skip gracefully if network unavailable
        pytest.importorskip("httpx")
        try:
            data = await adapter._fetch_job_questions("embed", "1")
        except Exception:
            pytest.skip("Could not reach Greenhouse API or job ID not found")
        assert isinstance(data, dict)

    @pytest.mark.asyncio
    async def test_dry_run_submission(
        self, adapter: GreenhouseAdapter, profile: ApplicantProfile
    ) -> None:
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4 test content")
            tmp_path = f.name

        dry_job = JobListing(
            company="TestCo",
            role="Software Engineer",
            ats="greenhouse",
            apply_url="https://boards.greenhouse.io/testco/jobs/4567890",
            resume_path=tmp_path,
        )

        # Patch _fetch_job_questions to return synthetic data so no network needed
        async def _mock_fetch(board_token: str, job_id: str) -> dict:
            return {
                "questions": [
                    _question("First Name", "first_name"),
                    _question("Last Name", "last_name"),
                    _question("Email", "email"),
                    _question("Resume", "resume", field_type="input_file"),
                ]
            }

        adapter._fetch_job_questions = _mock_fetch  # type: ignore[method-assign]

        result = await adapter.submit(dry_job, profile, dry_run=True)
        assert result.status == "dry_run"
        assert result.adapter == "greenhouse"
        assert len(result.fields_filled) > 0

        os.unlink(tmp_path)
