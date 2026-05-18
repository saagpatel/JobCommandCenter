from __future__ import annotations

import time
from unittest.mock import MagicMock

from src.api.models import ApplicantProfile, JobListing
from src.adapters.linkedin import LinkedInAdapter


def _make_profile() -> ApplicantProfile:
    return ApplicantProfile(
        first_name="Jane",
        last_name="Doe",
        email="jane@example.com",
        phone="555-0100",
        linkedin_url="https://linkedin.com/in/janedoe",
        location="San Francisco, CA",
        authorized_to_work=True,
        requires_sponsorship=False,
    )


def _make_job(**overrides: object) -> JobListing:
    defaults: dict[str, object] = {
        "company": "Acme Corp",
        "role": "Software Engineer",
        "ats": "linkedin",
        "apply_url": "https://www.linkedin.com/jobs/view/12345",
        "resume_path": "/tmp/resume.pdf",
    }
    defaults.update(overrides)
    return JobListing(**defaults)  # type: ignore[arg-type]


class TestLinkedInAdapter:
    def test_name_property(self) -> None:
        adapter = LinkedInAdapter()
        assert adapter.name == "linkedin"

    async def test_validate_correct_ats(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_exists.return_value = True
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        # Need a real file for validation — skip file validation by mocking
        from unittest.mock import patch
        with patch("src.adapters.linkedin.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job())
        assert errors == []

    async def test_validate_wrong_ats(self) -> None:
        adapter = LinkedInAdapter()
        errors = await adapter.validate(_make_job(ats="ashby"))
        assert any("Expected ats='linkedin'" in e for e in errors)

    async def test_validate_no_linkedin_url(self) -> None:
        adapter = LinkedInAdapter()
        errors = await adapter.validate(_make_job(apply_url="https://example.com/jobs/123"))
        assert "apply_url must be hosted on linkedin.com" in errors

    async def test_validate_rejects_lookalike_linkedin_host(self) -> None:
        adapter = LinkedInAdapter()
        errors = await adapter.validate(_make_job(apply_url="https://evillinkedin.com/jobs/view/12345"))
        assert "apply_url must be hosted on linkedin.com" in errors

    async def test_validate_missing_resume(self) -> None:
        adapter = LinkedInAdapter()
        errors = await adapter.validate(_make_job(resume_path=""))
        assert any("resume_path" in e.lower() or "resume" in e.lower() for e in errors)

    async def test_validate_no_session(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_exists.return_value = False
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        from unittest.mock import patch
        with patch("src.adapters.linkedin.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job())
        assert any("log in" in e.lower() for e in errors)

    async def test_rate_limit_max_submissions(self) -> None:
        adapter = LinkedInAdapter()
        adapter._submission_count = 10

        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "Session limit" in (result.error or "")

    async def test_rate_limit_min_interval(self) -> None:
        adapter = LinkedInAdapter()
        adapter._submission_count = 1
        adapter._last_submission_time = time.monotonic()  # just submitted

        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "Rate limit" in (result.error or "")

    async def test_submit_no_pw_manager(self) -> None:
        adapter = LinkedInAdapter(pw_manager=None)
        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "PlaywrightManager" in (result.error or "")
