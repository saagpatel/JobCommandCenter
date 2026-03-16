from __future__ import annotations

from abc import ABC, abstractmethod

from src.api.models import ApplicantProfile, JobListing, SubmissionResult


class BaseAdapter(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable adapter identifier (e.g. 'ashby', 'greenhouse')."""

    @abstractmethod
    async def validate(self, job: JobListing) -> list[str]:
        """Validate that the job listing has all required fields for this adapter.

        Returns a list of validation error strings. An empty list means valid.
        """

    @abstractmethod
    async def submit(
        self,
        job: JobListing,
        profile: ApplicantProfile,
        dry_run: bool,
    ) -> SubmissionResult:
        """Submit a job application.

        When dry_run is True, performs all validation and field mapping but does
        not actually submit the application.
        """
