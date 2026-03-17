from __future__ import annotations

import json
import re

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

    @staticmethod
    def _extract_text(response: anthropic.types.Message) -> str:
        """Pull text from response content blocks."""
        for block in response.content:
            if block.type == "text":
                return block.text
        return ""

    @staticmethod
    def _parse_json(text: str) -> dict | None:
        """Try direct JSON parse, then markdown code block extraction."""
        try:
            result = json.loads(text)
            if isinstance(result, dict):
                return result
            return None
        except json.JSONDecodeError:
            json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
            if json_match:
                try:
                    result = json.loads(json_match.group(1))
                    if isinstance(result, dict):
                        return result
                except json.JSONDecodeError:
                    pass
            return None

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

        text = self._extract_text(response)
        result = self._parse_json(text)

        if result is not None:
            return {str(k): str(v) for k, v in result.items()}

        logger.warning("failed to parse Claude response as JSON", response_text=text[:200])
        return {}

    async def draft_followup(
        self,
        company: str,
        role: str,
        applied_date: str,
        notes: str | None = None,
    ) -> dict[str, str]:
        """Draft a professional follow-up email."""
        client = await self._get_client()

        system_prompt = (
            "You are a professional follow-up email writer. "
            "Write a concise follow-up email (3-4 sentences max) for a job application. "
            "Be professional, enthusiastic but not desperate. "
            "Do NOT use any placeholder text like [Your Name] or [Company]. "
            "Return a JSON object with 'subject' and 'body' keys. Only output valid JSON."
        )

        context = f"Company: {company}\nRole: {role}\nApplied: {applied_date}"
        if notes:
            context += f"\nNotes: {notes}"

        logger.info("requesting followup draft from Claude", company=company, role=role)

        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": context}],
        )

        text = self._extract_text(response)
        result = self._parse_json(text)

        if isinstance(result, dict) and "subject" in result and "body" in result:
            return {"subject": str(result["subject"]), "body": str(result["body"])}

        # Fallback
        logger.warning("Claude draft response missing subject/body", response_text=text[:200])
        return {
            "subject": f"Following up on {role} application",
            "body": text if text else f"I wanted to follow up on my application for the {role} position at {company}.",
        }

    async def interview_prep(
        self,
        company: str,
        role: str,
        jd_text: str | None = None,
        notes: str | None = None,
    ) -> str:
        """Generate an interview prep brief in markdown."""
        client = await self._get_client()

        system_prompt = (
            "You are an interview preparation coach. Generate a structured markdown brief with:\n"
            "## Company Overview\n"
            "## Recent News & Culture\n"
            "## 5 Likely Interview Questions (with suggested answers)\n"
            "## 3 Questions to Ask the Interviewer\n"
            "## Red Flags to Watch For\n\n"
            "Be specific to the company and role. Use concrete examples."
        )

        context = f"Company: {company}\nRole: {role}"
        if jd_text:
            context += f"\n\nJob Description:\n{jd_text}"
        if notes:
            context += f"\n\nNotes: {notes}"

        logger.info("requesting interview prep from Claude", company=company, role=role)

        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            system=system_prompt,
            messages=[{"role": "user", "content": context}],
        )

        return self._extract_text(response)
