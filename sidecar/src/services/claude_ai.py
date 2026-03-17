from __future__ import annotations

import json

import anthropic
import structlog

from src.api.models import ApplicantProfile, JobListing
from src.utils.credentials import get_credential

logger = structlog.get_logger(__name__)


class ClaudeAIService:
    def __init__(self) -> None:
        self._client: anthropic.AsyncAnthropic | None = None

    async def _get_client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            api_key = get_credential("anthropic-api-key")
            if not api_key:
                raise RuntimeError("Anthropic API key not found in Keychain")
            self._client = anthropic.AsyncAnthropic(api_key=api_key)
        return self._client

    async def map_fields(
        self,
        questions: list[dict[str, object]],
        profile: ApplicantProfile,
        job: JobListing,
    ) -> dict[str, str]:
        """Use Claude to map screening questions to answers from profile data."""
        client = await self._get_client()

        system_prompt = (
            f"You are filling out a job application for {profile.first_name} {profile.last_name} "
            f"applying to {job.role} at {job.company}. "
            "Answer screening questions concisely and truthfully based on the provided profile. "
            "Respond with a JSON object where keys are question labels and values are answer strings. "
            "Only output valid JSON, no other text."
        )

        profile_data = {
            "name": f"{profile.first_name} {profile.last_name}",
            "email": profile.email,
            "phone": profile.phone,
            "linkedin": profile.linkedin_url,
            "location": profile.location,
            "authorized_to_work": profile.authorized_to_work,
            "requires_sponsorship": profile.requires_sponsorship,
        }

        user_message = json.dumps({
            "questions": questions,
            "profile": profile_data,
            "custom_fields": job.custom_fields,
        }, indent=2)

        logger.info("requesting field mapping from Claude", question_count=len(questions))

        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )

        # Extract text from response
        text = ""
        for block in response.content:
            if block.type == "text":
                text = block.text
                break

        try:
            # Try to parse JSON directly
            result = json.loads(text)
            if not isinstance(result, dict):
                logger.warning("Claude returned non-dict JSON", response_text=text[:200])
                return {}
            return {str(k): str(v) for k, v in result.items()}
        except json.JSONDecodeError:
            # Try to extract JSON from markdown code blocks
            import re
            json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
            if json_match:
                try:
                    result = json.loads(json_match.group(1))
                    if isinstance(result, dict):
                        return {str(k): str(v) for k, v in result.items()}
                except json.JSONDecodeError:
                    pass
            logger.warning("failed to parse Claude response as JSON", response_text=text[:200])
            return {}
