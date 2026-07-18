from __future__ import annotations

import asyncio
import os
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import pytest
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

from src.services.playwright_base import (
    BlockedNavigation,
    PlatformNavigationGuard,
    classify_platform_url,
)

_RUN_LOCAL_BROWSER_TEST = os.environ.get("JCC_RUN_LOCAL_BROWSER_INTEGRATION") == "1"
_DEFAULT_CHROME = Path(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _RUN_LOCAL_BROWSER_TEST,
        reason="set JCC_RUN_LOCAL_BROWSER_INTEGRATION=1 to run local Chrome proof",
    ),
]


class _LoopbackProbe:
    def __init__(self, redirect_to: str | None = None) -> None:
        self.paths: list[str] = []
        self.server: asyncio.Server | None = None
        self.redirect_to = redirect_to

    async def start(self) -> str:
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        socket = self.server.sockets[0]
        port = socket.getsockname()[1]
        return f"http://127.0.0.1:{port}"

    async def close(self) -> None:
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()

    async def wait_for_paths(self, expected: set[str]) -> None:
        for _ in range(100):
            if expected.issubset(self.paths):
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"loopback requests not observed: {expected - set(self.paths)}")

    async def _handle(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            request_line = await reader.readline()
            parts = request_line.decode("ascii", errors="replace").split()
            path = urlparse(parts[1]).path if len(parts) >= 2 else "<invalid>"
            self.paths.append(path)

            while await reader.readline() not in (b"\r\n", b""):
                pass

            if path == "/redirect-source" and self.redirect_to is not None:
                writer.write(
                    b"HTTP/1.1 302 Found\r\n"
                    b"Connection: close\r\n"
                    + f"Location: {self.redirect_to}\r\n".encode("ascii")
                    + b"Content-Length: 0\r\n\r\n"
                )
                await writer.drain()
                return

            if path == "/asset":
                body = (
                    b'<svg xmlns="http://www.w3.org/2000/svg" '
                    b'width="1" height="1"></svg>'
                )
                content_type = b"image/svg+xml"
            else:
                body = b"<!doctype html><title>loopback frame</title>"
                content_type = b"text/html; charset=utf-8"

            writer.write(
                b"HTTP/1.1 200 OK\r\n"
                + b"Connection: close\r\n"
                + b"Content-Type: "
                + content_type
                + b"\r\n"
                + f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
                + body
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()


async def _wait_for_block(
    guard: PlatformNavigationGuard,
) -> BlockedNavigation:
    for _ in range(100):
        blocked = guard.take_blocked_navigation()
        if blocked is not None:
            return blocked
        await asyncio.sleep(0.01)
    raise AssertionError("navigation guard did not record a blocked request")


async def test_real_context_blocks_popup_and_redirect_before_destination_contact(
    tmp_path: Path,
) -> None:
    chrome = Path(os.environ.get("JCC_SYSTEM_CHROME_PATH", _DEFAULT_CHROME))
    assert chrome.is_file() and os.access(chrome, os.X_OK), (
        f"executable Chrome is required for local integration proof: {chrome}"
    )

    destination_probe = _LoopbackProbe()
    destination_origin = await destination_probe.start()
    redirect_probe = _LoopbackProbe(
        redirect_to=(
            f"{destination_origin}/redirect?token=secret#resume"
        )
    )
    redirect_origin = await redirect_probe.start()
    trusted_redirect_probe = _LoopbackProbe(
        redirect_to=f"{destination_origin}/trusted-redirect"
    )
    trusted_redirect_origin = await trusted_redirect_probe.start()

    try:
        async with async_playwright() as playwright:
            context = await playwright.chromium.launch_persistent_context(
                user_data_dir=str(tmp_path / "profile"),
                executable_path=str(chrome),
                headless=True,
                args=[
                    "--disable-background-networking",
                    "--disable-component-update",
                    "--disable-default-apps",
                    "--disable-sync",
                    "--metrics-recording-only",
                    "--no-default-browser-check",
                    "--no-first-run",
                    (
                        "--host-resolver-rules="
                        "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"
                    ),
                ],
            )
            try:
                guard = PlatformNavigationGuard("linkedin")
                await guard.install(context)
                page = await context.new_page()
                await guard.prepare_page(page)

                await page.set_content(
                    f'<img src="{destination_origin}/asset" alt="">'
                    f'<iframe src="{destination_origin}/frame"></iframe>'
                )
                await destination_probe.wait_for_paths({"/asset", "/frame"})
                legitimate_request_count = len(destination_probe.paths)

                async with page.expect_popup() as popup_info:
                    await page.evaluate(
                        "(url) => window.open(url, '_blank')",
                        (
                            f"{destination_origin}"
                            "/popup?token=secret#resume"
                        ),
                    )
                popup = await popup_info.value
                popup_block = await _wait_for_block(guard)
                await page.wait_for_timeout(100)

                assert popup_block == BlockedNavigation(
                    platform="linkedin",
                    disposition="popup",
                    display_url=f"{destination_origin}/popup",
                )
                assert len(destination_probe.paths) == legitimate_request_count
                await popup.close()

                redirect_source = f"{redirect_origin}/redirect-source"

                def classify_local_source(platform: str, url: str) -> str:
                    if url == redirect_source:
                        return "trusted"
                    return classify_platform_url(platform, url)

                with patch(
                    "src.services.playwright_base.classify_platform_url",
                    side_effect=classify_local_source,
                ):
                    with pytest.raises(
                        PlaywrightError,
                        match="ERR_BLOCKED_BY_CLIENT",
                    ):
                        await page.goto(redirect_source)

                assert len(destination_probe.paths) == legitimate_request_count, (
                    "redirect destination received a request before the guard "
                    f"recorded a block: {destination_probe.paths}"
                )
                redirect_block = await _wait_for_block(guard)
                await page.wait_for_timeout(100)

                assert redirect_probe.paths == ["/redirect-source"]
                assert redirect_block == BlockedNavigation(
                    platform="linkedin",
                    disposition="invalid",
                    display_url=f"{destination_origin}/redirect",
                )
                assert len(destination_probe.paths) == legitimate_request_count

                trusted_redirect_source = (
                    f"{trusted_redirect_origin}/redirect-source"
                )
                trusted_redirect_target = (
                    f"{destination_origin}/trusted-redirect"
                )

                def classify_trusted_chain(platform: str, url: str) -> str:
                    if url in (
                        trusted_redirect_source,
                        trusted_redirect_target,
                    ):
                        return "trusted"
                    return classify_platform_url(platform, url)

                guard.clear()
                with patch(
                    "src.services.playwright_base.classify_platform_url",
                    side_effect=classify_trusted_chain,
                ):
                    await page.goto(trusted_redirect_source)

                assert trusted_redirect_probe.paths == ["/redirect-source"]
                assert destination_probe.paths[-1] == "/trusted-redirect"
                assert guard.take_blocked_navigation() is None
            finally:
                await context.close()
    finally:
        await trusted_redirect_probe.close()
        await redirect_probe.close()
        await destination_probe.close()
