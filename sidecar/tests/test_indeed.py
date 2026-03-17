from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters.indeed import IndeedAdapter
from src.api.models import ApplicantProfile, JobListing


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
        "ats": "indeed",
        "apply_url": "https://www.indeed.com/viewjob?jk=12345",
        "resume_path": "/tmp/resume.pdf",
    }
    defaults.update(overrides)
    return JobListing(**defaults)  # type: ignore[arg-type]


class TestIndeedAdapter:
    def test_name_property(self) -> None:
        adapter = IndeedAdapter()
        assert adapter.name == "indeed"

    async def test_validate_correct_ats(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_exists.return_value = True
        adapter = IndeedAdapter(pw_manager=pw_mgr)

        with patch("src.adapters.indeed.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job())
        assert errors == []

    async def test_validate_wrong_ats(self) -> None:
        adapter = IndeedAdapter()
        errors = await adapter.validate(_make_job(ats="ashby"))
        assert any("Expected ats='indeed'" in e for e in errors)

    async def test_validate_no_indeed_url(self) -> None:
        adapter = IndeedAdapter()
        errors = await adapter.validate(_make_job(apply_url="https://example.com/jobs/123"))
        assert any("indeed.com" in e for e in errors)

    async def test_validate_missing_resume(self) -> None:
        adapter = IndeedAdapter()
        errors = await adapter.validate(_make_job(resume_path=""))
        assert any("resume" in e.lower() for e in errors)

    async def test_validate_no_session(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_exists.return_value = False
        adapter = IndeedAdapter(pw_manager=pw_mgr)

        with patch("src.adapters.indeed.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job())
        assert any("log in" in e.lower() for e in errors)

    async def test_rate_limit_max_submissions(self) -> None:
        adapter = IndeedAdapter()
        adapter._submission_count = 15

        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "Session limit" in (result.error or "")

    async def test_rate_limit_min_interval(self) -> None:
        adapter = IndeedAdapter()
        adapter._submission_count = 1
        adapter._last_submission_time = time.monotonic()  # just submitted

        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "Rate limit" in (result.error or "")

    async def test_submit_no_pw_manager(self) -> None:
        adapter = IndeedAdapter(pw_manager=None)
        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "PlaywrightManager" in (result.error or "")

    async def test_submit_redirect_detection(self) -> None:
        # Mock page that reports a non-indeed URL after goto
        mock_page = MagicMock()
        mock_page.url = "https://external-ats.com/apply/12345"
        mock_page.goto = AsyncMock()
        mock_page.is_closed.return_value = False
        mock_page.close = AsyncMock()

        mock_context = MagicMock()
        mock_context.new_page = AsyncMock(return_value=mock_page)

        mock_pw_mgr = MagicMock()
        mock_pw_mgr.get_context = AsyncMock(return_value=mock_context)

        adapter = IndeedAdapter(pw_manager=mock_pw_mgr)

        with patch("src.adapters.indeed.random_delay", new=AsyncMock()):
            result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)

        assert result.status == "manual_required"
        assert "redirected" in (result.error or "").lower()
        assert "external-ats.com" in (result.error or "")
