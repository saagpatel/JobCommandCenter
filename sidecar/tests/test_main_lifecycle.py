from __future__ import annotations

import asyncio

import pytest

from src import main


def test_configured_parent_pid_is_optional_and_rejects_invalid_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("JCC_PARENT_PID", raising=False)
    assert main._configured_parent_pid() is None

    for value in ("", "not-a-pid", "0", "-1"):
        monkeypatch.setenv("JCC_PARENT_PID", value)
        assert main._configured_parent_pid() is None

    monkeypatch.setenv("JCC_PARENT_PID", "42")
    assert main._configured_parent_pid() == 42


@pytest.mark.asyncio
async def test_parent_exit_requests_sidecar_shutdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shutdown_event = asyncio.Event()
    checks = iter((True, False))

    async def no_delay(_seconds: float) -> None:
        return None

    monkeypatch.setattr(main.asyncio, "sleep", no_delay)
    monkeypatch.setattr(
        main,
        "_parent_process_alive",
        lambda _parent_pid: next(checks),
    )

    await main._watch_parent(shutdown_event, 42)

    assert shutdown_event.is_set()
