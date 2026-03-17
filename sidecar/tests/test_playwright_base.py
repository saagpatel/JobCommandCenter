from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.playwright_base import (
    PlaywrightManager,
    random_delay,
    screenshot_on_failure,
)


class TestPlaywrightManager:
    def test_session_exists_no_dir(self, tmp_path: Path) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path / "nonexistent"))
        assert mgr.session_exists("linkedin") is False

    def test_session_exists_empty_dir(self, tmp_path: Path) -> None:
        (tmp_path / "linkedin").mkdir()
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        assert mgr.session_exists("linkedin") is False

    def test_session_exists_with_data(self, tmp_path: Path) -> None:
        linkedin_dir = tmp_path / "linkedin"
        linkedin_dir.mkdir()
        (linkedin_dir / "Cookies").touch()
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        assert mgr.session_exists("linkedin") is True

    def test_list_sessions_empty(self, tmp_path: Path) -> None:
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        sessions = mgr.list_sessions()
        assert len(sessions) == 2
        assert sessions[0] == {"platform": "linkedin", "has_data": False}
        assert sessions[1] == {"platform": "indeed", "has_data": False}

    def test_list_sessions_with_data(self, tmp_path: Path) -> None:
        linkedin_dir = tmp_path / "linkedin"
        linkedin_dir.mkdir()
        (linkedin_dir / "Cookies").touch()
        mgr = PlaywrightManager(profile_base_dir=str(tmp_path))
        sessions = mgr.list_sessions()
        assert sessions[0] == {"platform": "linkedin", "has_data": True}
        assert sessions[1] == {"platform": "indeed", "has_data": False}


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
