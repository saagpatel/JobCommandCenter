from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from playwright.async_api import Error as PlaywrightError

from src.services.playwright_base import (
    BrowserRuntime,
    BrowserUnavailableError,
    BlockedNavigation,
    PlatformNavigationGuard,
    PlatformSessionExpiredError,
    PlaywrightManager,
    SessionStatus,
    UntrustedPlatformUrlError,
    classify_platform_url,
    is_authentication_url,
    is_authenticated_url,
    is_trusted_platform_url,
    random_delay,
    require_trusted_platform_url,
    resolve_browser_runtime,
    sanitize_url_for_display,
    screenshot_on_failure,
    wait_for_authenticated_session,
)
from src.api.routes import platform_login


class TestPlaywrightManager:
    async def test_navigation_guard_blocks_external_popup_before_contact(self) -> None:
        guard = PlatformNavigationGuard("indeed")
        route = AsyncMock()
        request = MagicMock()
        request.url = "https://external-ats.example/apply?token=secret#resume"
        request.is_navigation_request.return_value = True
        request.frame.parent_frame = None

        await guard.handle(route, request)

        route.abort.assert_awaited_once_with("blockedbyclient")
        route.continue_.assert_not_awaited()
        assert guard.take_blocked_navigation() == BlockedNavigation(
            platform="indeed",
            disposition="external",
            display_url="https://external-ats.example/apply",
        )
        assert guard.take_blocked_navigation() is None

    async def test_navigation_guard_blocks_popup_before_frame_exists(self) -> None:
        guard = PlatformNavigationGuard("linkedin")
        route = AsyncMock()
        request = MagicMock()
        request.url = "https://external.example/popup?token=secret#resume"
        request.is_navigation_request.return_value = True
        type(request).frame = PropertyMock(
            side_effect=PlaywrightError(
                "Frame for this navigation request is not available"
            )
        )

        await guard.handle(route, request)

        route.abort.assert_awaited_once_with("blockedbyclient")
        route.continue_.assert_not_awaited()
        assert guard.take_blocked_navigation() == BlockedNavigation(
            platform="linkedin",
            disposition="popup",
            display_url="https://external.example/popup",
        )

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.linkedin.com/jobs/view/123",
            "https://www.linkedin.com/login",
        ],
    )
    async def test_navigation_guard_allows_platform_and_auth_navigation(
        self, url: str
    ) -> None:
        guard = PlatformNavigationGuard("linkedin")
        route = AsyncMock()
        request = MagicMock()
        request.url = url
        request.is_navigation_request.return_value = True
        request.frame.parent_frame = None

        await guard.handle(route, request)

        route.continue_.assert_awaited_once()
        route.abort.assert_not_awaited()
        assert guard.take_blocked_navigation() is None

    @pytest.mark.parametrize(
        ("is_navigation", "has_parent"),
        [(False, False), (True, True)],
    )
    async def test_navigation_guard_preserves_assets_and_subframes(
        self, is_navigation: bool, has_parent: bool
    ) -> None:
        guard = PlatformNavigationGuard("indeed")
        route = AsyncMock()
        request = MagicMock()
        request.url = "https://cdn.external.example/resource"
        request.is_navigation_request.return_value = is_navigation
        request.frame.parent_frame = MagicMock() if has_parent else None

        await guard.handle(route, request)

        route.continue_.assert_awaited_once()
        route.abort.assert_not_awaited()

    def test_navigation_guard_sanitizes_credentials_query_and_fragment(self) -> None:
        assert (
            sanitize_url_for_display(
                "https://user:password@external.example/apply?token=secret#resume"
            )
            == "https://external.example/apply"
        )
        assert sanitize_url_for_display("not a URL?token=secret") == "<invalid URL>"

    async def test_get_context_installs_navigation_guard(
        self, tmp_path: Path
    ) -> None:
        browser = tmp_path / "chromium"
        browser.touch(mode=0o755)
        context = AsyncMock()
        context.pages = []
        playwright = MagicMock()
        playwright.chromium.executable_path = str(browser)
        playwright.chromium.launch_persistent_context = AsyncMock(
            return_value=context
        )
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path / "profiles"))
        mgr._ensure_playwright = AsyncMock(return_value=playwright)  # type: ignore[method-assign]

        result = await mgr.get_context("linkedin")

        assert result is context
        context.route.assert_awaited_once()
        route_pattern, route_handler = context.route.await_args.args
        assert route_pattern == "**/*"
        assert callable(route_handler)
        assert (
            playwright.chromium.launch_persistent_context.await_args.kwargs[
                "service_workers"
            ]
            == "block"
        )

        page = MagicMock()
        session = MagicMock()
        session.on = MagicMock()
        session.send = AsyncMock(
            side_effect=[
                {"frameTree": {"frame": {"id": "main-frame"}}},
                {},
            ]
        )
        context.new_cdp_session = AsyncMock(return_value=session)

        await mgr.prepare_page("linkedin", page)

        context.new_cdp_session.assert_awaited_once_with(page)
        fetch_enable_call = session.send.await_args_list[1]
        assert fetch_enable_call.args[0] == "Fetch.enable"
        assert fetch_enable_call.args[1]["patterns"][0] == {
            "urlPattern": "*",
            "resourceType": "Document",
            "requestStage": "Response",
        }

    async def test_unsupported_context_does_not_install_platform_guard(
        self, tmp_path: Path
    ) -> None:
        browser = tmp_path / "chromium"
        browser.touch(mode=0o755)
        context = MagicMock()
        context.pages = []
        context.route = AsyncMock()
        context.add_init_script = AsyncMock()
        context.close = AsyncMock()
        playwright = MagicMock()
        playwright.chromium.executable_path = str(browser)
        playwright.chromium.launch_persistent_context = AsyncMock(
            return_value=context
        )
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path / "profiles"))
        mgr._ensure_playwright = AsyncMock(return_value=playwright)  # type: ignore[method-assign]

        first = await mgr.get_context("generic")
        second = await mgr.get_context("generic")

        assert first is context
        assert second is context
        context.route.assert_not_awaited()
        assert (
            "service_workers"
            not in playwright.chromium.launch_persistent_context.await_args.kwargs
        )
        playwright.chromium.launch_persistent_context.assert_awaited_once()

    async def test_installed_guard_fails_closed_for_unprepared_page(self) -> None:
        context = MagicMock()
        context.route = AsyncMock()
        guard = PlatformNavigationGuard("indeed")
        await guard.install(context)
        route = AsyncMock()
        page = MagicMock()
        request = MagicMock()
        request.url = "https://www.indeed.com/viewjob?jk=123"
        request.is_navigation_request.return_value = True
        request.frame.parent_frame = None
        request.frame.page = page

        await guard.handle(route, request)

        route.abort.assert_awaited_once_with("blockedbyclient")
        route.continue_.assert_not_awaited()
        assert guard.take_blocked_navigation() == BlockedNavigation(
            platform="indeed",
            disposition="guard_unavailable",
            display_url="https://www.indeed.com/viewjob",
        )

    async def test_get_context_fails_closed_when_guard_installation_fails(
        self, tmp_path: Path
    ) -> None:
        browser = tmp_path / "chromium"
        browser.touch(mode=0o755)
        context = AsyncMock()
        context.route.side_effect = RuntimeError("route install failed")
        playwright = MagicMock()
        playwright.chromium.executable_path = str(browser)
        playwright.chromium.launch_persistent_context = AsyncMock(
            return_value=context
        )
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path / "profiles"))
        mgr._ensure_playwright = AsyncMock(return_value=playwright)  # type: ignore[method-assign]

        with pytest.raises(RuntimeError, match="route install failed"):
            await mgr.get_context("indeed")

        context.close.assert_awaited_once()
        assert "indeed" not in mgr._contexts

    def test_resolve_browser_runtime_prefers_playwright_chromium(
        self, tmp_path: Path
    ) -> None:
        bundled = tmp_path / "playwright" / "chromium"
        bundled.parent.mkdir()
        bundled.touch()
        bundled.chmod(0o755)
        system = tmp_path / "Google Chrome"
        system.touch()
        system.chmod(0o755)

        runtime = resolve_browser_runtime(str(bundled), (system,))

        assert runtime == BrowserRuntime(source="playwright", executable_path=bundled)

    def test_resolve_browser_runtime_falls_back_to_system_chrome(
        self, tmp_path: Path
    ) -> None:
        missing_bundled = tmp_path / "playwright" / "chromium"
        system = tmp_path / "Google Chrome"
        system.touch()
        system.chmod(0o755)

        runtime = resolve_browser_runtime(str(missing_bundled), (system,))

        assert runtime == BrowserRuntime(source="system_chrome", executable_path=system)

    def test_resolve_browser_runtime_reports_unavailable(self, tmp_path: Path) -> None:
        runtime = resolve_browser_runtime(
            str(tmp_path / "missing-playwright-chromium"),
            (tmp_path / "missing-system-chrome",),
        )

        assert runtime is None

    def test_resolve_browser_runtime_rejects_non_executable_files(
        self, tmp_path: Path
    ) -> None:
        browser = tmp_path / "not-executable"
        browser.touch(mode=0o644)

        assert resolve_browser_runtime(str(browser), ()) is None

    def test_system_chrome_override_supports_isolated_unavailable_fixture(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv(
            "JCC_SYSTEM_CHROME_PATH",
            str(tmp_path / "intentionally-missing-chrome"),
        )

        from src.services.playwright_base import system_chrome_candidates

        assert system_chrome_candidates() == (
            tmp_path / "intentionally-missing-chrome",
        )

    async def test_browser_readiness_reports_unavailable_without_creating_profile(
        self, tmp_path: Path
    ) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path / "profiles"))
        playwright = MagicMock()
        playwright.chromium.executable_path = str(tmp_path / "missing-chromium")
        mgr._ensure_playwright = AsyncMock(return_value=playwright)  # type: ignore[method-assign]

        with patch(
            "src.services.playwright_base.system_chrome_candidates",
            return_value=(),
        ):
            readiness = await mgr.browser_readiness()
            with pytest.raises(BrowserUnavailableError):
                await mgr.get_context("linkedin")

        assert readiness.status == "unavailable"
        assert readiness.source is None
        assert "Install Google Chrome" in readiness.message
        assert not (tmp_path / "profiles").exists()

    async def test_login_route_returns_actionable_unavailable_error(self) -> None:
        request = MagicMock()
        request.app.state.playwright.get_context = AsyncMock(
            side_effect=BrowserUnavailableError(
                "Browser automation is unavailable. Install Google Chrome, then "
                "check again in Settings."
            )
        )

        response = await platform_login(request, "linkedin")

        assert response.status == "error"
        assert response.message is not None
        assert "Install Google Chrome" in response.message

    async def test_login_route_preserves_sanitized_navigation_block(self) -> None:
        request = MagicMock()
        page = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        request.app.state.playwright.get_context = AsyncMock(return_value=context)
        request.app.state.playwright.prepare_page = AsyncMock()
        request.app.state.playwright.raise_for_blocked_navigation.side_effect = (
            UntrustedPlatformUrlError(
                "linkedin",
                "https://external.example/login?token=secret#resume",
                "external",
            )
        )

        response = await platform_login(request, "linkedin")

        assert response.status == "error"
        assert response.message == (
            "Login stopped before leaving the trusted platform: "
            "https://external.example/login"
        )
        assert "secret" not in response.message
        page.close.assert_awaited_once()

    async def test_login_route_marks_session_only_after_authentication_proof(
        self,
    ) -> None:
        request = MagicMock()
        page = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        request.app.state.playwright.get_context = AsyncMock(return_value=context)
        request.app.state.playwright.prepare_page = AsyncMock()

        with patch(
            "src.api.routes.wait_for_authenticated_session",
            new=AsyncMock(),
        ) as wait_for_authentication:
            response = await platform_login(request, "indeed")

        request.app.state.playwright.mark_session_unverified.assert_called_once_with(
            "indeed"
        )
        wait_for_authentication.assert_awaited_once_with(page, "indeed")
        request.app.state.playwright.mark_session_authenticated.assert_called_once_with(
            "indeed"
        )
        page.close.assert_awaited_once()
        assert response.status == "logged_in"

    async def test_login_timeout_preserves_unverified_state(self) -> None:
        request = MagicMock()
        page = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        request.app.state.playwright.get_context = AsyncMock(return_value=context)
        request.app.state.playwright.prepare_page = AsyncMock()

        with patch(
            "src.api.routes.wait_for_authenticated_session",
            new=AsyncMock(side_effect=TimeoutError("not authenticated")),
        ):
            response = await platform_login(request, "indeed")

        request.app.state.playwright.mark_session_unverified.assert_called_once_with(
            "indeed"
        )
        request.app.state.playwright.mark_session_authenticated.assert_not_called()
        page.close.assert_awaited_once()
        assert response.status == "error"
        assert response.message == "Login was not verified within 2 minutes."

    async def test_login_receipt_failure_is_not_reported_as_timeout(self) -> None:
        request = MagicMock()
        page = AsyncMock()
        context = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        request.app.state.playwright.get_context = AsyncMock(return_value=context)
        request.app.state.playwright.prepare_page = AsyncMock()
        request.app.state.playwright.mark_session_authenticated.side_effect = OSError(
            "read-only profile"
        )

        with patch(
            "src.api.routes.wait_for_authenticated_session",
            new=AsyncMock(),
        ):
            response = await platform_login(request, "linkedin")

        assert response.status == "error"
        assert response.message is not None
        assert "could not save" in response.message
        assert "permissions" in response.message
        page.close.assert_awaited_once()

    def test_session_status_no_dir(self, tmp_path: Path) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path / "nonexistent"))
        assert mgr.session_status("linkedin") == SessionStatus(
            status="not_connected",
            message="No saved LinkedIn session was found.",
        )

    def test_session_status_empty_dir(self, tmp_path: Path) -> None:
        (tmp_path / "linkedin").mkdir()
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        assert mgr.session_status("linkedin").status == "not_connected"

    def test_stray_browser_data_is_not_an_authenticated_session(
        self, tmp_path: Path
    ) -> None:
        linkedin_dir = tmp_path / "linkedin"
        linkedin_dir.mkdir()
        (linkedin_dir / "Cookies").touch()
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        assert mgr.session_status("linkedin").status == "not_connected"
        assert mgr.session_authenticated("linkedin") is False

    def test_verified_session_requires_reverification_after_restart(
        self, tmp_path: Path
    ) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        mgr.mark_session_authenticated("linkedin")

        assert mgr.session_status("linkedin").status == "authenticated"
        assert mgr.session_authenticated("linkedin") is True

        restarted = PlaywrightManager(profile_base_dir=str(tmp_path))
        status = restarted.session_status("linkedin")
        assert status.status == "verification_required"
        assert "Verify" in status.message
        assert restarted.session_authenticated("linkedin") is False

    def test_malformed_session_receipt_is_not_trusted(self, tmp_path: Path) -> None:
        profile = tmp_path / "indeed"
        profile.mkdir()
        (profile / ".jcc-session.json").write_text("{not-json", encoding="utf-8")

        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))

        assert mgr.session_status("indeed").status == "not_connected"

    def test_list_sessions_empty(self, tmp_path: Path) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        sessions = mgr.list_sessions()
        assert len(sessions) == 2
        assert sessions[0]["status"] == "not_connected"
        assert sessions[1]["status"] == "not_connected"

    def test_list_sessions_distinguishes_authenticated_and_saved(
        self, tmp_path: Path
    ) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        mgr.mark_session_authenticated("linkedin")
        mgr.mark_session_authenticated("indeed")
        mgr.mark_session_unverified("indeed")

        sessions = mgr.list_sessions()

        assert sessions[0]["status"] == "authenticated"
        assert sessions[1]["status"] == "verification_required"

    def test_indeed_login_url_is_not_authenticated(self) -> None:
        assert is_authenticated_url("indeed", "https://secure.indeed.com/auth") is False
        assert is_authenticated_url("indeed", "https://www.indeed.com/account/login") is False
        assert is_authentication_url("indeed", "https://secure.indeed.com/auth") is True

    def test_linkedin_checkpoint_revokes_authentication(self) -> None:
        assert (
            is_authentication_url(
                "linkedin",
                "https://www.linkedin.com/checkpoint/challenge/123",
            )
            is True
        )
        assert is_authentication_url("linkedin", "https://www.linkedin.com/jobs") is False

    def test_authenticated_urls_are_platform_scoped(self) -> None:
        assert is_authenticated_url("linkedin", "https://www.linkedin.com/feed/") is True
        assert is_authenticated_url("linkedin", "http://www.linkedin.com/feed/") is False
        assert is_authenticated_url("linkedin", "https://evil.example/feed/") is False
        assert is_authenticated_url("indeed", "https://www.indeed.com/jobs") is True
        assert is_authenticated_url("indeed", "https://evilindeed.com/jobs") is False

    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://www.indeed.com/viewjob?jk=123", "trusted"),
            ("https://jobs.indeed.com/viewjob?jk=123", "trusted"),
            ("https://secure.indeed.com/auth", "authentication"),
            ("https://evilindeed.com/viewjob?jk=123", "external"),
            ("https://indeed.com.evil.example/viewjob", "external"),
            ("https://indeed.com@evil.example/viewjob", "invalid"),
            ("http://www.indeed.com/viewjob?jk=123", "invalid"),
            ("https://www.indeed.com:444/viewjob?jk=123", "invalid"),
        ],
    )
    def test_platform_url_classifier_is_origin_exact(
        self, url: str, expected: str
    ) -> None:
        assert classify_platform_url("indeed", url) == expected

    def test_trusted_platform_url_preserves_legitimate_vendor_subdomains(self) -> None:
        assert (
            is_trusted_platform_url(
                "linkedin",
                "https://www.linkedin.com/jobs/view/123",
            )
            is True
        )
        assert (
            is_trusted_platform_url(
                "indeed",
                "https://www.indeed.com/viewjob?jk=123",
            )
            is True
        )

    def test_navigation_guard_classifies_auth_and_external_redirects(self) -> None:
        with pytest.raises(PlatformSessionExpiredError):
            require_trusted_platform_url(
                "linkedin",
                "https://www.linkedin.com/checkpoint/challenge/123",
            )
        with pytest.raises(UntrustedPlatformUrlError) as external:
            require_trusted_platform_url(
                "indeed",
                "https://evilindeed.com/application?token=secret#resume",
            )
        assert external.value.disposition == "external"
        assert external.value.url == "https://evilindeed.com/application"
        assert "secret" not in str(external.value)

    async def test_indeed_authentication_requires_account_ui(self) -> None:
        page = AsyncMock()
        page.url = "https://www.indeed.com/jobs"

        await wait_for_authenticated_session(page, "indeed", timeout_ms=25)

        page.wait_for_selector.assert_awaited_once()

    async def test_indeed_authentication_rejects_account_ui_on_login_url(self) -> None:
        page = AsyncMock()
        page.url = "https://secure.indeed.com/auth"
        page.wait_for_url.side_effect = TimeoutError("still on login")

        with pytest.raises(TimeoutError):
            await wait_for_authenticated_session(page, "indeed", timeout_ms=25)


class TestRandomDelay:
    async def test_random_delay_range(self) -> None:
        import time
        start = time.monotonic()
        await random_delay(0.05, 0.1)
        elapsed = time.monotonic() - start
        assert elapsed >= 0.04  # small tolerance
        assert elapsed < 0.5


class TestScreenshotOnFailure:
    async def test_screenshot_creates_file(self, tmp_path: Path) -> None:
        mock_page = AsyncMock()

        with patch("src.services.playwright_base.Path") as mock_path_cls:
            screenshots_dir = tmp_path / "screenshots"
            mock_expanduser = MagicMock(return_value=screenshots_dir)
            mock_path_instance = MagicMock()
            mock_path_instance.expanduser.return_value = screenshots_dir
            mock_path_cls.return_value = mock_path_instance

            # Just verify the function calls page.screenshot
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            await screenshot_on_failure(mock_page, "test_failure")
            mock_page.screenshot.assert_called_once()
