from __future__ import annotations

import time

from fastapi import APIRouter, Request

from .models import HealthResponse, SubmissionRequest, SubmissionResult

router = APIRouter()


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
