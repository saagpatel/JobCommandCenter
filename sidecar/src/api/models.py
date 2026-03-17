from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    adapters: list[str]


class ApplicantProfile(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    linkedin_url: str
    location: str
    authorized_to_work: bool
    requires_sponsorship: bool
    preferred_name: str | None = None
    base_resume_path: str | None = None


class JobListing(BaseModel):
    company: str
    role: str
    ats: Literal["ashby", "greenhouse", "linkedin", "indeed", "gem", "workday", "generic"]
    apply_url: str
    job_posting_id: str | None = None
    board_token: str | None = None
    resume_path: str
    cover_letter_path: str | None = None
    custom_fields: dict = {}
    source: str = "Company careers page"
    tier: Literal["tier1", "tier2", "tier3"] = "tier1"


class SubmissionRequest(BaseModel):
    job: JobListing
    profile: ApplicantProfile
    dry_run: bool = True


class FieldMappingResult(BaseModel):
    field_submissions: list[dict] = []
    file_references: dict[str, str] = {}
    unmapped_required: list[str] = []
    warnings: list[str] = []
    fields_filled: list[str] = []
    fields_skipped: list[str] = []


class SubmissionResult(BaseModel):
    job_id: str
    company: str
    role: str
    adapter: str
    status: Literal["success", "failed", "dry_run", "manual_required"]
    resume_uploaded: bool
    cover_letter_uploaded: bool
    fields_filled: list[str] = []
    fields_skipped: list[str] = []
    error: str | None = None
    duration_seconds: float
    timestamp: str


class BatchSubmissionRequest(BaseModel):
    jobs: list[JobListing]
    profile: ApplicantProfile
    dry_run: bool = True


class PlatformLoginResponse(BaseModel):
    platform: str
    status: Literal["browser_opened", "logged_in", "error"]
    message: str | None = None


class PlatformSessionStatus(BaseModel):
    platform: str
    has_session: bool


class FieldMappingRequest(BaseModel):
    questions: list[dict[str, object]]
    profile: ApplicantProfile
    job: JobListing


class FieldMappingResponse(BaseModel):
    mapped_answers: dict[str, str]
    unmapped: list[str]


class DraftFollowupRequest(BaseModel):
    company: str
    role: str
    applied_date: str
    notes: str | None = None


class DraftFollowupResponse(BaseModel):
    subject: str
    body: str


class InterviewPrepRequest(BaseModel):
    company: str
    role: str
    jd_text: str | None = None
    notes: str | None = None


class InterviewPrepResponse(BaseModel):
    brief: str


class GmailSendRequest(BaseModel):
    to: str
    subject: str
    body_html: str
    reply_to: str | None = None


class GmailSendResponse(BaseModel):
    message_id: str
    thread_id: str


class GmailStatusResponse(BaseModel):
    authorized: bool
    email: str | None = None
