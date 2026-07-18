from __future__ import annotations

import hmac
import time

import structlog
from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse

from .models import (
    BatchSubmissionRequest,
    BrowserReadinessResponse,
    DraftFollowupRequest,
    DraftFollowupResponse,
    FieldMappingRequest,
    FieldMappingResponse,
    GmailSendRequest,
    GmailSendResponse,
    GmailStatusResponse,
    HealthResponse,
    InterviewPrepRequest,
    InterviewPrepResponse,
    PlatformLoginResponse,
    PlatformSessionStatus,
    SubmissionRequest,
    SubmissionResult,
)
from src.services.playwright_base import (
    BlockedNavigation,
    BrowserUnavailableError,
    UntrustedPlatformUrlError,
    wait_for_authenticated_session,
)

router = APIRouter()
logger = structlog.get_logger(__name__)


def check_submit_authorized(
    expected_token: str | None, dry_run: bool, provided_token: str | None
) -> None:
    """Defense-in-depth for the never-auto-submit rule.

    A dry-run preview is always allowed. A LIVE submission requires a submit
    token that only the trusted desktop app holds (injected into the sidecar at
    spawn and fetched by the webview over Tauri IPC). Any other local process
    hitting this endpoint with ``dry_run=false`` is refused. Fail-closed: if no
    token is configured, live submission is rejected.
    """
    if dry_run:
        return
    if (
        not expected_token
        or not provided_token
        or not hmac.compare_digest(provided_token, expected_token)
    ):
        raise HTTPException(
            status_code=403,
            detail="Live submission requires a valid submit token",
        )


@router.post("/submit/batch")
async def submit_batch(request: Request, body: BatchSubmissionRequest) -> StreamingResponse:
    check_submit_authorized(
        getattr(request.app.state, "submit_token", None),
        body.dry_run,
        request.headers.get("X-Submit-Token"),
    )
    registry = request.app.state.registry

    async def event_stream():  # type: ignore[return]
        for job in body.jobs:
            adapter = registry.get(job.ats)
            if adapter is None:
                result = SubmissionResult(
                    job_id=job.id or "",
                    company=job.company,
                    role=job.role,
                    adapter=job.ats,
                    status="failed",
                    resume_uploaded=False,
                    cover_letter_uploaded=False,
                    error=f"No adapter registered for ATS: {job.ats}",
                    duration_seconds=0,
                    timestamp="",
                )
            else:
                result = await adapter.submit(job, body.profile, body.dry_run)
                if job.id:
                    result = result.model_copy(update={"job_id": job.id})
            yield f"data: {result.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/submit", response_model=SubmissionResult)
async def submit(request: Request, body: SubmissionRequest) -> SubmissionResult:
    check_submit_authorized(
        getattr(request.app.state, "submit_token", None),
        body.dry_run,
        request.headers.get("X-Submit-Token"),
    )
    registry = request.app.state.registry
    adapter = registry.get(body.job.ats)
    if adapter is None:
        return SubmissionResult(
            job_id=body.job.id or "",
            company=body.job.company,
            role=body.job.role,
            adapter=body.job.ats,
            status="failed",
            resume_uploaded=False,
            cover_letter_uploaded=False,
            error=f"No adapter registered for ATS: {body.job.ats}",
            duration_seconds=0,
            timestamp="",
        )
    result = await adapter.submit(body.job, body.profile, body.dry_run)
    return result.model_copy(update={"job_id": body.job.id}) if body.job.id else result


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    startup_time: float = request.app.state.startup_time
    uptime = time.monotonic() - startup_time
    registry = request.app.state.registry
    return HealthResponse(
        status="ok",
        version="0.1.0",
        uptime_seconds=uptime,
        adapters=registry.list(),
    )


@router.post("/shutdown")
async def shutdown(request: Request) -> dict[str, str]:
    request.app.state.shutdown_event.set()
    return {"status": "shutting_down"}


_LOGIN_URLS: dict[str, str] = {
    "linkedin": "https://www.linkedin.com/login",
    "indeed": "https://secure.indeed.com/auth",
}

_SUPPORTED_PLATFORMS = frozenset(_LOGIN_URLS.keys())


@router.post("/playwright/sessions/{platform}/login", response_model=PlatformLoginResponse)
async def platform_login(request: Request, platform: str) -> PlatformLoginResponse:
    if platform not in _SUPPORTED_PLATFORMS:
        return PlatformLoginResponse(
            platform=platform, status="error", message=f"Unknown platform: {platform}"
        )

    pw_mgr = request.app.state.playwright
    page = None
    try:
        ctx = await pw_mgr.get_context(platform)
        pw_mgr.clear_blocked_navigations(platform)
        page = await ctx.new_page()
        await pw_mgr.prepare_page(platform, page)
        pw_mgr.mark_session_unverified(platform)
        await page.goto(_LOGIN_URLS[platform])
        pw_mgr.raise_for_blocked_navigation(platform)
    except BrowserUnavailableError as exc:
        return PlatformLoginResponse(
            platform=platform,
            status="error",
            message=str(exc),
        )
    except UntrustedPlatformUrlError as exc:
        if page is not None:
            await page.close()
        return PlatformLoginResponse(
            platform=platform,
            status="error",
            message=(
                "Login stopped before leaving the trusted platform: "
                f"{exc.url}"
            ),
        )
    except Exception:
        blocked = pw_mgr.take_blocked_navigation(platform)
        if page is not None:
            await page.close()
        logger.exception("platform browser login failed to start", platform=platform)
        return PlatformLoginResponse(
            platform=platform,
            status="error",
            message=(
                "Login stopped before leaving the trusted platform: "
                f"{blocked.display_url}"
                if isinstance(blocked, BlockedNavigation)
                else (
                    "The login browser could not open. Check browser readiness "
                    "and retry."
                )
            ),
        )

    try:
        try:
            await wait_for_authenticated_session(page, platform)
        except Exception:
            blocked = pw_mgr.take_blocked_navigation(platform)
            if isinstance(blocked, BlockedNavigation):
                return PlatformLoginResponse(
                    platform=platform,
                    status="error",
                    message=(
                        "Login stopped before leaving the trusted platform: "
                        f"{blocked.display_url}"
                    ),
                )
            return PlatformLoginResponse(
                platform=platform,
                status="error",
                message="Login was not verified within 2 minutes.",
            )

        try:
            pw_mgr.mark_session_authenticated(platform)
        except Exception:
            logger.exception(
                "platform session verification receipt could not be saved",
                platform=platform,
            )
            return PlatformLoginResponse(
                platform=platform,
                status="error",
                message=(
                    "Login was observed, but Job Command Center could not save "
                    "the verification receipt. Check profile folder permissions "
                    "and retry."
                ),
            )

        return PlatformLoginResponse(platform=platform, status="logged_in")
    finally:
        try:
            await page.close()
        except Exception:
            logger.warning("platform login page did not close", platform=platform)


@router.get("/playwright/readiness", response_model=BrowserReadinessResponse)
async def playwright_readiness(request: Request) -> BrowserReadinessResponse:
    readiness = await request.app.state.playwright.browser_readiness()
    return BrowserReadinessResponse(
        status=readiness.status,
        source=readiness.source,
        message=readiness.message,
    )


@router.get("/playwright/sessions", response_model=list[PlatformSessionStatus])
async def list_sessions(request: Request) -> list[PlatformSessionStatus]:
    pw_mgr = request.app.state.playwright
    return [
        PlatformSessionStatus(
            platform=platform,
            status=(status := pw_mgr.session_status(platform)).status,
            message=status.message,
        )
        for platform in ("linkedin", "indeed")
    ]


@router.post("/ai/map-fields", response_model=FieldMappingResponse)
async def ai_map_fields(request: Request, body: FieldMappingRequest) -> FieldMappingResponse:
    claude = request.app.state.claude
    mapped = await claude.map_fields(body.questions, body.profile, body.job)
    unmapped = [
        str(q.get("label", "")) for q in body.questions if str(q.get("label", "")) not in mapped
    ]
    return FieldMappingResponse(mapped_answers=mapped, unmapped=unmapped)


@router.post("/gmail/auth", response_model=GmailStatusResponse)
async def gmail_auth(request: Request) -> GmailStatusResponse:
    try:
        result = await request.app.state.gmail.authorize()
        return GmailStatusResponse(**result)
    except FileNotFoundError as e:
        return GmailStatusResponse(authorized=False, email=str(e))
    except Exception:
        return GmailStatusResponse(authorized=False, email=None)


@router.get("/gmail/status", response_model=GmailStatusResponse)
async def gmail_status(request: Request) -> GmailStatusResponse:
    result = await request.app.state.gmail.check_status()
    return GmailStatusResponse(**result)


@router.post("/gmail/send", response_model=GmailSendResponse)
async def gmail_send(request: Request, body: GmailSendRequest) -> GmailSendResponse:
    result = await request.app.state.gmail.send_email(
        to=body.to,
        subject=body.subject,
        body_html=body.body_html,
        reply_to=body.reply_to,
    )
    return GmailSendResponse(**result)


@router.post("/gmail/disconnect", response_model=GmailStatusResponse)
async def gmail_disconnect(request: Request) -> GmailStatusResponse:
    await request.app.state.gmail.disconnect()
    return GmailStatusResponse(authorized=False, email=None)


@router.post("/ai/draft-followup", response_model=DraftFollowupResponse)
async def ai_draft_followup(request: Request, body: DraftFollowupRequest) -> DraftFollowupResponse:
    result = await request.app.state.claude.draft_followup(
        company=body.company,
        role=body.role,
        applied_date=body.applied_date,
        notes=body.notes,
    )
    return DraftFollowupResponse(**result)


@router.post("/ai/interview-prep", response_model=InterviewPrepResponse)
async def ai_interview_prep(request: Request, body: InterviewPrepRequest) -> InterviewPrepResponse:
    brief = await request.app.state.claude.interview_prep(
        company=body.company,
        role=body.role,
        jd_text=body.jd_text,
        notes=body.notes,
    )
    return InterviewPrepResponse(brief=brief)
