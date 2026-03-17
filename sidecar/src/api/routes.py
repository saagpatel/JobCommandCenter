from __future__ import annotations

import time

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from .models import (
    BatchSubmissionRequest,
    FieldMappingRequest,
    FieldMappingResponse,
    HealthResponse,
    PlatformLoginResponse,
    PlatformSessionStatus,
    SubmissionRequest,
    SubmissionResult,
)

router = APIRouter()


@router.post("/submit/batch")
async def submit_batch(request: Request, body: BatchSubmissionRequest) -> StreamingResponse:
    registry = request.app.state.registry

    async def event_stream():  # type: ignore[return]
        for job in body.jobs:
            adapter = registry.get(job.ats)
            if adapter is None:
                result = SubmissionResult(
                    job_id="",
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
            yield f"data: {result.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/submit", response_model=SubmissionResult)
async def submit(request: Request, body: SubmissionRequest) -> SubmissionResult:
    registry = request.app.state.registry
    adapter = registry.get(body.job.ats)
    if adapter is None:
        return SubmissionResult(
            job_id="",
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
    return await adapter.submit(body.job, body.profile, body.dry_run)


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

_SUCCESS_PATTERNS: dict[str, str] = {
    "linkedin": "**/feed*",
    "indeed": "**indeed.com/**",
}

_SUPPORTED_PLATFORMS = frozenset(_LOGIN_URLS.keys())


@router.post("/playwright/sessions/{platform}/login", response_model=PlatformLoginResponse)
async def platform_login(request: Request, platform: str) -> PlatformLoginResponse:
    if platform not in _SUPPORTED_PLATFORMS:
        return PlatformLoginResponse(platform=platform, status="error", message=f"Unknown platform: {platform}")

    pw_mgr = request.app.state.playwright
    ctx = await pw_mgr.get_context(platform)
    page = await ctx.new_page()
    await page.goto(_LOGIN_URLS[platform])

    try:
        await page.wait_for_url(_SUCCESS_PATTERNS[platform], timeout=120_000)
        await page.close()
        return PlatformLoginResponse(platform=platform, status="logged_in")
    except Exception:
        await page.close()
        return PlatformLoginResponse(platform=platform, status="error", message="Login timed out after 2 minutes")


@router.get("/playwright/sessions", response_model=list[PlatformSessionStatus])
async def list_sessions(request: Request) -> list[PlatformSessionStatus]:
    pw_mgr = request.app.state.playwright
    return [
        PlatformSessionStatus(platform=p, has_session=pw_mgr.session_exists(p))
        for p in ("linkedin", "indeed")
    ]


@router.post("/ai/map-fields", response_model=FieldMappingResponse)
async def ai_map_fields(request: Request, body: FieldMappingRequest) -> FieldMappingResponse:
    claude = request.app.state.claude
    mapped = await claude.map_fields(body.questions, body.profile, body.job)
    unmapped = [str(q.get("label", "")) for q in body.questions if str(q.get("label", "")) not in mapped]
    return FieldMappingResponse(mapped_answers=mapped, unmapped=unmapped)
