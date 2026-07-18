from __future__ import annotations

import asyncio
import json
import os
import random
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Literal
from urllib.parse import urljoin, urlparse, urlunparse

import structlog
from playwright.async_api import (
    BrowserContext,
    CDPSession,
    Error as PlaywrightError,
    Page,
    Playwright,
    Request,
    Route,
    async_playwright,
)

logger = structlog.get_logger(__name__)

BrowserSource = Literal["playwright", "system_chrome"]
BrowserReadinessStatus = Literal["ready", "unavailable", "error"]
SessionState = Literal["not_connected", "verification_required", "authenticated"]
PlatformUrlDisposition = Literal["trusted", "authentication", "external", "invalid"]

_SESSION_RECEIPT_NAME = ".jcc-session.json"
_SESSION_RECEIPT_VERSION = 1
_PLATFORM_DOMAINS = {
    "linkedin": "linkedin.com",
    "indeed": "indeed.com",
}
_INDEED_ACCOUNT_SELECTOR = (
    '[data-gnav-element-name="AccountMenu"], '
    '[aria-label="Account menu"], '
    '[aria-label="Account Menu"]'
)


@dataclass(frozen=True)
class BrowserRuntime:
    source: BrowserSource
    executable_path: Path


@dataclass(frozen=True)
class BrowserReadiness:
    status: BrowserReadinessStatus
    source: BrowserSource | None
    message: str


@dataclass(frozen=True)
class SessionStatus:
    status: SessionState
    message: str


@dataclass(frozen=True)
class BlockedNavigation:
    platform: str
    disposition: Literal[
        "external",
        "invalid",
        "popup",
        "guard_unavailable",
    ]
    display_url: str


class BrowserUnavailableError(RuntimeError):
    """Raised when browser-backed workflows have no local browser executable."""


class PlatformSessionExpiredError(RuntimeError):
    """Raised when a trusted platform navigation reaches authentication UI."""


class UntrustedPlatformUrlError(RuntimeError):
    def __init__(
        self,
        platform: str,
        url: str,
        disposition: Literal[
            "external",
            "invalid",
            "popup",
            "guard_unavailable",
        ],
    ) -> None:
        self.platform = platform
        self.url = sanitize_url_for_display(url)
        self.disposition = disposition
        super().__init__(f"{platform} navigation is {disposition}: {self.url}")


def system_chrome_candidates() -> tuple[Path, ...]:
    override = os.environ.get("JCC_SYSTEM_CHROME_PATH")
    if override is not None:
        return (Path(override),) if override else ()

    if sys.platform == "darwin":
        return (
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").expanduser(),
        )

    if sys.platform == "win32":
        roots = (
            os.environ.get("PROGRAMFILES"),
            os.environ.get("PROGRAMFILES(X86)"),
            os.environ.get("LOCALAPPDATA"),
        )
        return tuple(
            Path(root) / "Google/Chrome/Application/chrome.exe"
            for root in roots
            if root
        )

    names = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
    return tuple(Path(path) for name in names if (path := shutil.which(name)))


def resolve_browser_runtime(
    playwright_executable: str,
    chrome_candidates: Iterable[Path] | None = None,
) -> BrowserRuntime | None:
    bundled = Path(playwright_executable).expanduser()
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return BrowserRuntime(source="playwright", executable_path=bundled)

    candidates = (
        tuple(chrome_candidates)
        if chrome_candidates is not None
        else system_chrome_candidates()
    )
    for candidate in candidates:
        expanded = candidate.expanduser()
        if expanded.is_file() and os.access(expanded, os.X_OK):
            return BrowserRuntime(source="system_chrome", executable_path=expanded)

    return None


def _host_matches(host: str | None, domain: str) -> bool:
    return host == domain or bool(host and host.endswith(f".{domain}"))


def _is_authentication_path(platform: str, path: str) -> bool:
    if platform == "linkedin":
        return (
            path == "/login"
            or path.startswith("/login/")
            or path == "/uas/login"
            or path.startswith("/uas/login/")
            or path == "/checkpoint"
            or path.startswith("/checkpoint/")
        )

    if platform == "indeed":
        return (
            path == "/auth"
            or path.startswith("/auth/")
            or path == "/account/login"
            or path.startswith("/account/login/")
        )

    return False


def classify_platform_url(platform: str, url: str) -> PlatformUrlDisposition:
    domain = _PLATFORM_DOMAINS.get(platform)
    if domain is None:
        return "invalid"

    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return "invalid"
    host = parsed.hostname
    path = parsed.path.rstrip("/") or "/"

    if (
        parsed.scheme != "https"
        or host is None
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        return "invalid"
    if not _host_matches(host, domain):
        return "external"
    if _is_authentication_path(platform, path):
        return "authentication"
    return "trusted"


def sanitize_url_for_display(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        return "<invalid URL>"
    if parsed.scheme not in ("http", "https") or host is None:
        return "<invalid URL>"

    display_host = f"[{host}]" if ":" in host else host
    default_port = 443 if parsed.scheme == "https" else 80
    netloc = (
        f"{display_host}:{port}"
        if port is not None and port != default_port
        else display_host
    )
    return urlunparse(
        (
            parsed.scheme,
            netloc,
            parsed.path or "/",
            "",
            "",
            "",
        )
    )


class PlatformNavigationGuard:
    def __init__(self, platform: str) -> None:
        self._platform = platform
        self._blocked: BlockedNavigation | None = None
        self._context: BrowserContext | None = None
        self._page_sessions: dict[Page, tuple[CDPSession, str]] = {}
        self._session_lock = asyncio.Lock()
        self._response_tasks: set[asyncio.Task[None]] = set()

    async def install(self, context: BrowserContext) -> None:
        self._context = context
        await context.route("**/*", self.handle)

    def _record_blocked(
        self,
        url: str,
        disposition: Literal[
            "external",
            "invalid",
            "popup",
            "guard_unavailable",
        ],
    ) -> None:
        blocked = BlockedNavigation(
            platform=self._platform,
            disposition=disposition,
            display_url=sanitize_url_for_display(url),
        )
        self._blocked = blocked
        logger.warning(
            "blocked untrusted top-level navigation",
            platform=self._platform,
            disposition=disposition,
            display_url=blocked.display_url,
        )

    async def prepare_page(self, page: Page) -> None:
        if self._context is None or page in self._page_sessions:
            return

        async with self._session_lock:
            if page in self._page_sessions:
                return

            session = await self._context.new_cdp_session(page)
            frame_tree = await session.send("Page.getFrameTree")
            main_frame_id = frame_tree["frameTree"]["frame"]["id"]
            self._page_sessions[page] = (session, main_frame_id)

            def handle_paused(params: dict[str, object]) -> None:
                task = asyncio.create_task(
                    self._handle_paused_response(
                        session,
                        main_frame_id,
                        params,
                    )
                )
                self._response_tasks.add(task)
                task.add_done_callback(self._response_tasks.discard)

            session.on("Fetch.requestPaused", handle_paused)
            await session.send(
                "Fetch.enable",
                {
                    "patterns": [
                        {
                            "urlPattern": "*",
                            "resourceType": "Document",
                            "requestStage": "Response",
                        }
                    ]
                },
            )

    async def _handle_paused_response(
        self,
        session: CDPSession,
        main_frame_id: str,
        params: dict[str, object],
    ) -> None:
        request_id = str(params["requestId"])
        request = params.get("request")
        request_url = (
            str(request.get("url"))
            if isinstance(request, dict)
            else "<invalid URL>"
        )
        try:
            status = params.get("responseStatusCode")
            frame_id = params.get("frameId")
            headers = params.get("responseHeaders")
            if (
                frame_id == main_frame_id
                and status in (301, 302, 303, 307, 308)
                and isinstance(headers, list)
            ):
                location = next(
                    (
                        str(header["value"])
                        for header in headers
                        if isinstance(header, dict)
                        and str(header.get("name", "")).lower() == "location"
                    ),
                    None,
                )
                if location is not None:
                    redirect_url = urljoin(request_url, location)
                    disposition = classify_platform_url(
                        self._platform,
                        redirect_url,
                    )
                    if disposition in ("external", "invalid"):
                        self._record_blocked(redirect_url, disposition)
                        await session.send(
                            "Fetch.failRequest",
                            {
                                "requestId": request_id,
                                "errorReason": "BlockedByClient",
                            },
                        )
                        return

            await session.send(
                "Fetch.continueResponse",
                {"requestId": request_id},
            )
        except Exception:
            self._record_blocked(request_url, "guard_unavailable")
            logger.exception(
                "redirect response guard failed closed",
                platform=self._platform,
            )
            try:
                await session.send(
                    "Fetch.failRequest",
                    {
                        "requestId": request_id,
                        "errorReason": "BlockedByClient",
                    },
                )
            except Exception:
                logger.exception(
                    "redirect response guard could not abort request",
                    platform=self._platform,
                )

    async def handle(self, route: Route, request: Request) -> None:
        is_top_level_navigation = False
        page: Page | None = None
        if request.is_navigation_request():
            try:
                frame = request.frame
                is_top_level_navigation = frame.parent_frame is None
                page = frame.page
            except PlaywrightError:
                # Popup navigation can be routed before Playwright creates its
                # frame. It is therefore top-level and must remain guarded.
                is_top_level_navigation = True

        if is_top_level_navigation:
            if page is None:
                self._record_blocked(request.url, "popup")
                await route.abort("blockedbyclient")
                return

            disposition = classify_platform_url(self._platform, request.url)
            if disposition in ("external", "invalid"):
                self._record_blocked(request.url, disposition)
                await route.abort("blockedbyclient")
                return

            if self._context is not None and page not in self._page_sessions:
                self._record_blocked(request.url, "guard_unavailable")
                await route.abort("blockedbyclient")
                return

        await route.continue_()

    def clear(self) -> None:
        self._blocked = None

    def take_blocked_navigation(self) -> BlockedNavigation | None:
        blocked = self._blocked
        self._blocked = None
        return blocked


def is_trusted_platform_url(platform: str, url: str) -> bool:
    return classify_platform_url(platform, url) == "trusted"


def is_authenticated_url(platform: str, url: str) -> bool:
    if not is_trusted_platform_url(platform, url):
        return False
    path = urlparse(url).path.rstrip("/") or "/"
    if platform == "linkedin":
        return path == "/feed" or path.startswith("/feed/")
    return platform == "indeed"


def is_authentication_url(platform: str, url: str) -> bool:
    return classify_platform_url(platform, url) == "authentication"


def require_trusted_platform_url(platform: str, url: str) -> None:
    disposition = classify_platform_url(platform, url)
    if disposition == "trusted":
        return
    if disposition == "authentication":
        raise PlatformSessionExpiredError(
            f"{platform} navigation requires session verification"
        )
    raise UntrustedPlatformUrlError(platform, url, disposition)


async def wait_for_authenticated_session(
    page: Page,
    platform: str,
    timeout_ms: float = 120_000,
) -> None:
    if platform == "linkedin":
        await page.wait_for_url(
            lambda url: is_authenticated_url(platform, str(url)),
            timeout=timeout_ms,
        )
        return

    if platform == "indeed":
        await page.wait_for_selector(
            _INDEED_ACCOUNT_SELECTOR,
            state="visible",
            timeout=timeout_ms,
        )
        if not is_authenticated_url(platform, page.url):
            await page.wait_for_url(
                lambda url: is_authenticated_url(platform, str(url)),
                timeout=timeout_ms,
            )
        return

    raise ValueError(f"Unsupported platform: {platform}")


class PlaywrightManager:
    def __init__(self, profile_base_dir: str = "~/.jcc/playwright_data") -> None:
        self._profile_base = Path(profile_base_dir).expanduser()
        self._playwright: Playwright | None = None
        self._contexts: dict[str, BrowserContext] = {}
        self._navigation_guards: dict[str, PlatformNavigationGuard] = {}
        self._authenticated_platforms: set[str] = set()

    async def _ensure_playwright(self) -> Playwright:
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        return self._playwright

    async def browser_readiness(self) -> BrowserReadiness:
        try:
            playwright = await self._ensure_playwright()
            runtime = resolve_browser_runtime(playwright.chromium.executable_path)
        except Exception:
            logger.exception("playwright driver readiness check failed")
            return BrowserReadiness(
                status="error",
                source=None,
                message=(
                    "The browser automation service could not start. Restart Job "
                    "Command Center, then check again."
                ),
            )

        if runtime is None:
            return BrowserReadiness(
                status="unavailable",
                source=None,
                message=(
                    "Browser automation is unavailable. Install Google Chrome, "
                    "then check again. Job Command Center will not download a "
                    "browser automatically."
                ),
            )

        message = (
            "The bundled automation browser is ready."
            if runtime.source == "playwright"
            else "Google Chrome is ready and will use an isolated JCC profile."
        )
        return BrowserReadiness(
            status="ready",
            source=runtime.source,
            message=message,
        )

    async def get_context(self, platform: str) -> BrowserContext:
        guard_required = platform in _PLATFORM_DOMAINS
        existing = self._contexts.get(platform)
        if existing is not None:
            # Check if context is still usable
            try:
                _ = existing.pages
                if not guard_required or platform in self._navigation_guards:
                    return existing
            except Exception:
                pass
            await existing.close()
            del self._contexts[platform]
            self._navigation_guards.pop(platform, None)

        pw = await self._ensure_playwright()
        runtime = resolve_browser_runtime(pw.chromium.executable_path)
        if runtime is None:
            raise BrowserUnavailableError(
                "Browser automation is unavailable. Install Google Chrome, then "
                "check again in Settings."
            )

        user_data_dir = self._profile_base / platform
        user_data_dir.mkdir(parents=True, exist_ok=True)

        launch_options: dict[str, object] = {
            "user_data_dir": str(user_data_dir),
            "headless": False,
            "executable_path": str(runtime.executable_path),
            "viewport": {"width": 1280, "height": 800},
        }
        if guard_required:
            launch_options["service_workers"] = "block"

        context = await pw.chromium.launch_persistent_context(
            **launch_options,
        )

        try:
            navigation_guard = (
                PlatformNavigationGuard(platform)
                if guard_required
                else None
            )
            if navigation_guard is not None:
                await navigation_guard.install(context)

            # Stealth: hide webdriver property
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
        except Exception:
            await context.close()
            raise

        self._contexts[platform] = context
        if navigation_guard is not None:
            self._navigation_guards[platform] = navigation_guard
        logger.info("playwright context created", platform=platform)
        return context

    def clear_blocked_navigations(self, platform: str) -> None:
        guard = self._navigation_guards.get(platform)
        if guard is not None:
            guard.clear()

    async def prepare_page(self, platform: str, page: Page) -> None:
        guard = self._navigation_guards.get(platform)
        if guard is not None:
            await guard.prepare_page(page)

    def take_blocked_navigation(self, platform: str) -> BlockedNavigation | None:
        guard = self._navigation_guards.get(platform)
        return guard.take_blocked_navigation() if guard is not None else None

    def raise_for_blocked_navigation(self, platform: str) -> None:
        blocked = self.take_blocked_navigation(platform)
        if blocked is not None:
            raise UntrustedPlatformUrlError(
                platform=platform,
                url=blocked.display_url,
                disposition=blocked.disposition,
            )

    async def close_context(self, platform: str) -> None:
        ctx = self._contexts.pop(platform, None)
        self._navigation_guards.pop(platform, None)
        if ctx is not None:
            await ctx.close()
            logger.info("playwright context closed", platform=platform)

    async def cleanup(self) -> None:
        for platform in list(self._contexts.keys()):
            await self.close_context(platform)
        self._authenticated_platforms.clear()
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None
        logger.info("playwright manager cleaned up")

    def _session_receipt_path(self, platform: str) -> Path:
        return self._profile_base / platform / _SESSION_RECEIPT_NAME

    def _has_saved_session(self, platform: str) -> bool:
        receipt_path = self._session_receipt_path(platform)
        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return False
        return (
            receipt.get("schema_version") == _SESSION_RECEIPT_VERSION
            and receipt.get("platform") == platform
            and isinstance(receipt.get("verified_at"), str)
        )

    def mark_session_authenticated(self, platform: str) -> None:
        receipt_path = self._session_receipt_path(platform)
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt = {
            "schema_version": _SESSION_RECEIPT_VERSION,
            "platform": platform,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }
        temporary_path = receipt_path.with_suffix(".tmp")
        temporary_path.write_text(
            json.dumps(receipt, sort_keys=True),
            encoding="utf-8",
        )
        temporary_path.replace(receipt_path)
        self._authenticated_platforms.add(platform)

    def mark_session_unverified(self, platform: str) -> None:
        self._authenticated_platforms.discard(platform)

    def session_authenticated(self, platform: str) -> bool:
        return platform in self._authenticated_platforms

    def session_status(self, platform: str) -> SessionStatus:
        display_name = {"linkedin": "LinkedIn", "indeed": "Indeed"}.get(
            platform, platform
        )
        if self.session_authenticated(platform):
            return SessionStatus(
                status="authenticated",
                message=f"{display_name} was verified during this app session.",
            )
        if self._has_saved_session(platform):
            return SessionStatus(
                status="verification_required",
                message=(
                    f"A saved {display_name} browser profile exists. Verify it "
                    "before submitting."
                ),
            )
        return SessionStatus(
            status="not_connected",
            message=f"No saved {display_name} session was found.",
        )

    def list_sessions(self) -> list[dict[str, object]]:
        platforms = ("linkedin", "indeed")
        return [
            {
                "platform": platform,
                "status": (status := self.session_status(platform)).status,
                "message": status.message,
            }
            for platform in platforms
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
