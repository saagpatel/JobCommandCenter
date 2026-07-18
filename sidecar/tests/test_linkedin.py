from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest

from src.api.models import ApplicantProfile, JobListing
from src.adapters.linkedin import LinkedInAdapter
from src.services.playwright_base import BlockedNavigation


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
        pw_mgr.session_authenticated.return_value = True
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
        assert any("linkedin.com" in e for e in errors)

    async def test_validate_rejects_lookalike_and_non_https_urls(self) -> None:
        adapter = LinkedInAdapter()

        lookalike = await adapter.validate(
            _make_job(apply_url="https://linkedin.com.evil.example/jobs/view/123")
        )
        insecure = await adapter.validate(
            _make_job(apply_url="http://www.linkedin.com/jobs/view/123")
        )

        assert any("trusted HTTPS LinkedIn" in error for error in lookalike)
        assert any("trusted HTTPS LinkedIn" in error for error in insecure)

    async def test_validate_missing_resume(self) -> None:
        adapter = LinkedInAdapter()
        errors = await adapter.validate(_make_job(resume_path=""))
        assert any("resume_path" in e.lower() or "resume" in e.lower() for e in errors)

    async def test_validate_no_session(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_authenticated.return_value = False
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        from unittest.mock import patch
        with patch("src.adapters.linkedin.validate_file", return_value=(True, "ok")):
            errors = await adapter.validate(_make_job())
        assert any("not verified" in e.lower() for e in errors)

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

    async def test_submit_rejects_unverified_session_before_browser_use(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_authenticated.return_value = False
        pw_mgr.get_context = AsyncMock()
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)

        assert result.status == "failed"
        assert "not verified" in (result.error or "").lower()
        pw_mgr.get_context.assert_not_awaited()

    async def test_submit_rejects_lookalike_url_before_browser_use(self) -> None:
        pw_mgr = MagicMock()
        pw_mgr.session_authenticated.return_value = True
        pw_mgr.get_context = AsyncMock()
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        result = await adapter.submit(
            _make_job(apply_url="https://evil-linkedin.com/jobs/view/123"),
            _make_profile(),
            dry_run=True,
        )

        assert result.status == "failed"
        assert "trusted HTTPS LinkedIn" in (result.error or "")
        pw_mgr.get_context.assert_not_awaited()

    async def test_submit_revokes_session_on_login_redirect(self) -> None:
        page = MagicMock()
        page.url = "https://www.linkedin.com/login"
        page.goto = AsyncMock()
        page.is_closed.return_value = False
        page.close = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        pw_mgr = MagicMock()
        pw_mgr.session_authenticated.return_value = True
        pw_mgr.get_context = AsyncMock(return_value=context)
        pw_mgr.prepare_page = AsyncMock()
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        with patch("src.adapters.linkedin.random_delay", new=AsyncMock()):
            result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)

        assert result.status == "manual_required"
        assert "expired" in (result.error or "").lower()
        pw_mgr.mark_session_unverified.assert_called_once_with("linkedin")

    async def test_submit_revokes_session_on_mid_flow_checkpoint(self) -> None:
        page = MagicMock()
        type(page).url = PropertyMock(
            side_effect=[
                "https://www.linkedin.com/jobs/view/12345",
                "https://www.linkedin.com/checkpoint/challenge/123",
            ]
        )
        page.goto = AsyncMock()
        page.is_closed.return_value = False
        page.close = AsyncMock()
        easy_apply = MagicMock()
        easy_apply.wait_for = AsyncMock()
        easy_apply.click = AsyncMock()
        page.locator.return_value = easy_apply
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        pw_mgr = MagicMock()
        pw_mgr.session_authenticated.return_value = True
        pw_mgr.get_context = AsyncMock(return_value=context)
        pw_mgr.prepare_page = AsyncMock()
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        with patch("src.adapters.linkedin.random_delay", new=AsyncMock()):
            result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)

        assert result.status == "manual_required"
        assert "expired" in (result.error or "").lower()
        pw_mgr.mark_session_unverified.assert_called_once_with("linkedin")

    async def test_blocked_popup_becomes_sanitized_manual_handoff(self) -> None:
        page = MagicMock()
        page.goto = AsyncMock(side_effect=RuntimeError("net::ERR_BLOCKED_BY_CLIENT"))
        page.is_closed.return_value = False
        page.close = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        pw_mgr = MagicMock()
        pw_mgr.session_authenticated.return_value = True
        pw_mgr.get_context = AsyncMock(return_value=context)
        pw_mgr.prepare_page = AsyncMock()
        pw_mgr.take_blocked_navigation.return_value = BlockedNavigation(
            platform="linkedin",
            disposition="external",
            display_url="https://external.example/apply",
        )
        adapter = LinkedInAdapter(pw_manager=pw_mgr)

        result = await adapter.submit(_make_job(), _make_profile(), dry_run=True)

        assert result.status == "manual_required"
        assert "https://external.example/apply" in (result.error or "")
        assert "token=" not in (result.error or "")
