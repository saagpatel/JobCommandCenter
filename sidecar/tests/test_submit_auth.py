"""Defense-in-depth checks for the never-auto-submit rule.

The safety property must not depend on the UI: any local process reaching the
sidecar with ``dry_run=false`` and no valid token must be refused.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.api.routes import check_submit_authorized


def test_dry_run_never_requires_a_token() -> None:
    # Previews are always allowed, even with no token configured.
    check_submit_authorized(expected_token=None, dry_run=True, provided_token=None)
    check_submit_authorized(expected_token="secret", dry_run=True, provided_token=None)


def test_live_submit_is_rejected_when_no_token_configured() -> None:
    # Fail-closed: a sidecar without a configured token refuses live submits.
    with pytest.raises(HTTPException) as exc:
        check_submit_authorized(expected_token=None, dry_run=False, provided_token="anything")
    assert exc.value.status_code == 403


def test_live_submit_is_rejected_without_header() -> None:
    with pytest.raises(HTTPException) as exc:
        check_submit_authorized(expected_token="secret", dry_run=False, provided_token=None)
    assert exc.value.status_code == 403


def test_live_submit_is_rejected_with_wrong_token() -> None:
    with pytest.raises(HTTPException) as exc:
        check_submit_authorized(expected_token="secret", dry_run=False, provided_token="wrong")
    assert exc.value.status_code == 403


def test_live_submit_is_allowed_with_matching_token() -> None:
    # The trusted app holds the injected token; this is the only path to a live submit.
    check_submit_authorized(expected_token="secret", dry_run=False, provided_token="secret")


# --- Route-level enforcement (proves the check fires through FastAPI) ---------

_JOB = {
    "company": "Acme",
    "role": "Engineer",
    "ats": "ashby",
    "apply_url": "https://jobs.example/acme/1",
    "resume_path": "/tmp/resume.pdf",
}
_PROFILE = {
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@example.com",
    "phone": "555-0100",
    "linkedin_url": "https://linkedin.com/in/jane",
    "location": "San Francisco, CA",
    "authorized_to_work": True,
    "requires_sponsorship": False,
}


def _client(token: str | None):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.api.routes import router

    app = FastAPI()
    app.state.submit_token = token
    app.include_router(router)
    return TestClient(app)


def test_route_refuses_live_submit_without_token() -> None:
    # No token configured; a live submit is refused before reaching any adapter.
    resp = _client(None).post("/submit", json={"job": _JOB, "profile": _PROFILE, "dry_run": False})
    assert resp.status_code == 403


def test_route_refuses_live_batch_with_wrong_token() -> None:
    resp = _client("the-real-token").post(
        "/submit/batch",
        json={"jobs": [_JOB], "profile": _PROFILE, "dry_run": False},
        headers={"X-Submit-Token": "guessed-wrong"},
    )
    assert resp.status_code == 403
