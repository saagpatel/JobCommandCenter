from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.adapters.gem import GemAdapter
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
        "ats": "gem",
        "apply_url": "https://jobs.gem.com/acme/12345",
        "resume_path": "/tmp/resume.pdf",
    }
    defaults.update(overrides)
    return JobListing(**defaults)  # type: ignore[arg-type]


class TestGemAdapter:
    def test_name_property(self) -> None:
        adapter = GemAdapter()
        assert adapter.name == "gem"

    async def test_validate_correct_ats(self) -> None:
        adapter = GemAdapter()

        with patch("src.adapters.gem.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job())
        assert errors == []

    async def test_validate_wrong_ats(self) -> None:
        adapter = GemAdapter()
        errors = await adapter.validate(_make_job(ats="ashby"))
        assert any("Expected ats='gem'" in e for e in errors)

    async def test_validate_empty_url(self) -> None:
        adapter = GemAdapter()
        with patch("src.adapters.gem.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job(apply_url=""))
        assert any("apply_url" in e for e in errors)

    async def test_validate_missing_resume(self) -> None:
        adapter = GemAdapter()
        errors = await adapter.validate(_make_job(resume_path=""))
        assert any("resume" in e.lower() for e in errors)

    async def test_submit_no_pw_manager(self) -> None:
        adapter = GemAdapter(pw_manager=None)
        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)
        assert result.status == "failed"
        assert "PlaywrightManager" in (result.error or "")
