from __future__ import annotations

import random
import time
from pathlib import Path

import structlog
from playwright.async_api import BrowserContext, Page, Playwright, async_playwright

logger = structlog.get_logger(__name__)


class PlaywrightManager:
    def __init__(self, profile_base_dir: str = "~/.jcc/playwright_data") -> None:
        self._profile_base = Path(profile_base_dir).expanduser()
        self._playwright: Playwright | None = None
        self._contexts: dict[str, BrowserContext] = {}

    async def _ensure_playwright(self) -> Playwright:
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        return self._playwright

    async def get_context(self, platform: str) -> BrowserContext:
        existing = self._contexts.get(platform)
        if existing is not None:
            # Check if context is still usable
            try:
                _ = existing.pages
                return existing
            except Exception:
                del self._contexts[platform]

        pw = await self._ensure_playwright()
        user_data_dir = self._profile_base / platform
        user_data_dir.mkdir(parents=True, exist_ok=True)

        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            headless=False,
            channel="chromium",
            viewport={"width": 1280, "height": 800},
        )

        # Stealth: hide webdriver property
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        self._contexts[platform] = context
        logger.info("playwright context created", platform=platform)
        return context

    async def close_context(self, platform: str) -> None:
        ctx = self._contexts.pop(platform, None)
        if ctx is not None:
            await ctx.close()
            logger.info("playwright context closed", platform=platform)

    async def cleanup(self) -> None:
        for platform in list(self._contexts.keys()):
            await self.close_context(platform)
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None
        logger.info("playwright manager cleaned up")

    def session_exists(self, platform: str) -> bool:
        profile_dir = self._profile_base / platform
        if not profile_dir.exists():
            return False
        # Check for meaningful session data (cookies, local storage)
        return any(profile_dir.iterdir())

    def list_sessions(self) -> list[dict[str, object]]:
        platforms = ("linkedin", "indeed")
        return [
            {"platform": p, "has_data": self.session_exists(p)}
            for p in platforms
        ]


async def random_delay(min_s: float = 0.3, max_s: float = 1.2) -> None:
    """Human-like pause between actions."""
    import asyncio
    delay = random.uniform(min_s, max_s)
    await asyncio.sleep(delay)


async def fill_field(page: Page, selector: str, value: str) -> None:
    """Click field, clear, type with per-character delay."""
    await page.click(selector)
    await page.fill(selector, "")
    await page.type(selector, value, delay=random.uniform(50, 120))


async def upload_file(page: Page, selector: str, file_path: str) -> None:
    """Upload file via set_input_files."""
    await page.set_input_files(selector, file_path)


async def click_button(page: Page, selector: str, timeout: float = 10_000) -> None:
    """Wait for selector, random delay, click, random delay after."""
    await page.wait_for_selector(selector, timeout=timeout)
    await random_delay(0.2, 0.5)
    await page.click(selector)
    await random_delay(0.3, 0.8)


async def select_option(page: Page, selector: str, value: str) -> None:
    """Select dropdown option by value or label text."""
    try:
        await page.select_option(selector, value=value)
    except Exception:
        await page.select_option(selector, label=value)


async def screenshot_on_failure(page: Page, name: str) -> str:
    """Save screenshot to ~/.jcc/screenshots/{timestamp}_{name}.png."""
    screenshots_dir = Path("~/.jcc/screenshots").expanduser()
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time())
    path = screenshots_dir / f"{timestamp}_{name}.png"
    await page.screenshot(path=str(path))
    logger.info("screenshot saved", path=str(path))
    return str(path)
